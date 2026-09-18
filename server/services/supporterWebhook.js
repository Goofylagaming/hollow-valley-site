const crypto = require("node:crypto");
const { db, getSupporterStatus } = require("../db");
const { TIERS } = require("./supporterCheckout");

const WEBHOOK_TOLERANCE_SECONDS = 300;
const ACTIVE_STATUSES = new Set(["active", "trialing"]);

function parseStripeSignature(header) {
  const values = String(header || "").split(",");
  const parsed = { timestamp: null, signatures: [] };
  for (const value of values) {
    const [key, ...rest] = value.trim().split("=");
    const val = rest.join("=");
    if (key === "t" && /^\d+$/.test(val)) parsed.timestamp = Number(val);
    if (key === "v1" && /^[a-f0-9]{64}$/i.test(val)) parsed.signatures.push(val.toLowerCase());
  }
  return parsed;
}

function verifyStripeSignature(rawBody, header, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!Buffer.isBuffer(rawBody) || !secret || !secret.startsWith("whsec_")) return false;
  const parsed = parseStripeSignature(header);
  if (!parsed.timestamp || parsed.signatures.length === 0) return false;
  if (Math.abs(nowSeconds - parsed.timestamp) > WEBHOOK_TOLERANCE_SECONDS) return false;

  const payload = Buffer.concat([
    Buffer.from(String(parsed.timestamp)),
    Buffer.from("."),
    rawBody,
  ]);
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");

  return parsed.signatures.some((signature) => {
    const left = Buffer.from(signature, "hex");
    const right = Buffer.from(expected, "hex");
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  });
}

function normalizeId(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && typeof value.id === "string") return value.id;
  return null;
}

function isoFromUnix(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0
    ? new Date(Number(value) * 1000).toISOString()
    : null;
}

function subscriptionPeriodEnd(subscription) {
  const direct = Number(subscription?.current_period_end) || 0;
  const itemEnd = subscription?.items?.data?.reduce((latest, item) => {
    return Math.max(latest, Number(item?.current_period_end) || 0);
  }, 0) || 0;
  return Math.max(direct, itemEnd);
}

function invoiceSubscriptionId(invoice) {
  return normalizeId(
    invoice?.subscription ||
    invoice?.parent?.subscription_details?.subscription ||
    invoice?.lines?.data?.[0]?.parent?.subscription_item_details?.subscription
  );
}

function tierFromSubscription(subscription, env = process.env) {
  const metadataTier = subscription?.metadata?.tier;
  if (metadataTier && Object.hasOwn(TIERS, metadataTier)) return metadataTier;

  const priceId = subscription?.items?.data?.[0]?.price?.id;
  const match = {
    [env.STRIPE_PRICE_MEMBER]: "member",
    [env.STRIPE_PRICE_ELITE]: "elite",
    [env.STRIPE_PRICE_LEGEND]: "legend",
  }[priceId];
  return match || null;
}

function userIdFromObject(object) {
  const value = object?.metadata?.user_id || object?.client_reference_id;
  return /^\d+$/.test(String(value || "")) ? Number(value) : null;
}

function ensureSupporterColumns() {
  const columns = db.prepare("PRAGMA table_info(supporter_subscriptions)").all();
  const names = new Set(columns.map((column) => column.name));
  const add = (name, sql) => {
    if (!names.has(name)) db.exec(`ALTER TABLE supporter_subscriptions ADD COLUMN ${name} ${sql};`);
  };
  add("stripe_customer_id", "TEXT");
  add("stripe_subscription_id", "TEXT");
  add("stripe_status", "TEXT");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_supporter_stripe_subscription ON supporter_subscriptions(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS stripe_webhook_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      processed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

ensureSupporterColumns();

function upsertSupporter({
  userId,
  tier,
  customerId = null,
  subscriptionId = null,
  status = "active",
  renewsAt = null,
  autoRenew = true,
}) {
  if (!userId || !tier || !Object.hasOwn(TIERS, tier)) return null;
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!user) return null;

  db.prepare(`
    INSERT INTO supporter_subscriptions (
      user_id, tier, auto_renew, renews_at, cancelled_at,
      stripe_customer_id, stripe_subscription_id, stripe_status
    )
    VALUES (?, ?, ?, ?, NULL, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      tier = excluded.tier,
      auto_renew = excluded.auto_renew,
      renews_at = COALESCE(excluded.renews_at, supporter_subscriptions.renews_at),
      cancelled_at = CASE WHEN excluded.auto_renew = 1 THEN NULL ELSE supporter_subscriptions.cancelled_at END,
      stripe_customer_id = COALESCE(excluded.stripe_customer_id, supporter_subscriptions.stripe_customer_id),
      stripe_subscription_id = COALESCE(excluded.stripe_subscription_id, supporter_subscriptions.stripe_subscription_id),
      stripe_status = excluded.stripe_status
  `).run(
    userId,
    tier,
    autoRenew ? 1 : 0,
    renewsAt,
    customerId,
    subscriptionId,
    status
  );
  return getSupporterStatus(userId);
}

function existingBySubscription(subscriptionId) {
  if (!subscriptionId) return null;
  return db.prepare("SELECT * FROM supporter_subscriptions WHERE stripe_subscription_id = ?").get(subscriptionId) || null;
}

function markBySubscription(subscriptionId, { status, autoRenew = null, renewsAt = null, cancelled = false }) {
  const existing = existingBySubscription(subscriptionId);
  if (!existing) return null;
  db.prepare(`
    UPDATE supporter_subscriptions
    SET stripe_status = ?,
        auto_renew = CASE WHEN ? IS NULL THEN auto_renew ELSE ? END,
        renews_at = COALESCE(?, renews_at),
        cancelled_at = CASE WHEN ? THEN datetime('now') ELSE cancelled_at END
    WHERE stripe_subscription_id = ?
  `).run(
    status,
    autoRenew === null ? null : (autoRenew ? 1 : 0),
    autoRenew === null ? null : (autoRenew ? 1 : 0),
    renewsAt,
    cancelled ? 1 : 0,
    subscriptionId
  );
  return getSupporterStatus(existing.user_id);
}

function alreadyProcessed(eventId) {
  return Boolean(db.prepare("SELECT 1 FROM stripe_webhook_events WHERE event_id = ?").get(eventId));
}

function recordProcessed(event) {
  db.prepare("INSERT OR IGNORE INTO stripe_webhook_events (event_id, event_type) VALUES (?, ?)").run(event.id, event.type);
}

function processStripeEvent(event, env = process.env) {
  if (!event?.id || !event?.type || event.livemode !== false) return { ignored: true };
  if (alreadyProcessed(event.id)) return { duplicate: true };

  const object = event.data?.object || {};

  if (event.type === "checkout.session.completed") {
    if (object.mode === "subscription") {
      const userId = userIdFromObject(object);
      const tier = object.metadata?.tier;
      const paid = object.payment_status === "paid" || object.payment_status === "no_payment_required";
      if (userId && Object.hasOwn(TIERS, tier)) {
        upsertSupporter({
          userId,
          tier,
          customerId: normalizeId(object.customer),
          subscriptionId: normalizeId(object.subscription),
          status: paid ? "active" : "pending",
          autoRenew: true,
        });
      }
    }
  } else if (event.type === "customer.subscription.updated") {
    const subscriptionId = normalizeId(object.id);
    const existing = existingBySubscription(subscriptionId);
    const userId = userIdFromObject(object) || existing?.user_id || null;
    const tier = tierFromSubscription(object, env) || existing?.tier || null;
    const autoRenew = !object.cancel_at_period_end && object.status !== "canceled";
    if (userId && tier) {
      upsertSupporter({
        userId,
        tier,
        customerId: normalizeId(object.customer),
        subscriptionId,
        status: object.status || "unknown",
        renewsAt: isoFromUnix(subscriptionPeriodEnd(object)),
        autoRenew,
      });
    }
  } else if (event.type === "customer.subscription.deleted") {
    const subscriptionId = normalizeId(object.id);
    const existing = existingBySubscription(subscriptionId);
    const userId = userIdFromObject(object) || existing?.user_id || null;
    const tier = tierFromSubscription(object, env) || existing?.tier || null;
    if (userId && tier) {
      upsertSupporter({
        userId,
        tier,
        customerId: normalizeId(object.customer),
        subscriptionId,
        status: "canceled",
        renewsAt: isoFromUnix(subscriptionPeriodEnd(object)),
        autoRenew: false,
      });
      markBySubscription(subscriptionId, {
        status: "canceled",
        autoRenew: false,
        renewsAt: isoFromUnix(subscriptionPeriodEnd(object)),
        cancelled: true,
      });
    }
  } else if (event.type === "invoice.paid") {
    const subscriptionId = invoiceSubscriptionId(object);
    if (subscriptionId) {
      const periodEnd = object.lines?.data?.reduce((latest, line) => {
        const end = Number(line?.period?.end) || 0;
        return Math.max(latest, end);
      }, 0);
      markBySubscription(subscriptionId, {
        status: "active",
        renewsAt: isoFromUnix(periodEnd),
      });
    }
  } else if (event.type === "invoice.payment_failed") {
    const subscriptionId = invoiceSubscriptionId(object);
    if (subscriptionId) {
      const existing = existingBySubscription(subscriptionId);
      if (existing) {
        markBySubscription(subscriptionId, {
          status: "past_due",
        });
      }
    }
  }

  recordProcessed(event);
  return { processed: true };
}

function isEntitled(status) {
  return ACTIVE_STATUSES.has(status);
}

module.exports = {
  verifyStripeSignature,
  processStripeEvent,
  tierFromSubscription,
  isEntitled,
  _test: {
    parseStripeSignature,
    isoFromUnix,
    subscriptionPeriodEnd,
    invoiceSubscriptionId,
    upsertSupporter,
    existingBySubscription,
  },
};
