const crypto = require("node:crypto");
const { db, getSupporterStatus } = require("../db");
const { liveModeEnabled } = require("./supporterCheckout");
const { TIERS, normalizeTier, tierFromStripePriceId } = require("./supporterTiers");

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
  // The actual subscribed Price is authoritative when Stripe includes it.
  // Metadata is a fallback for events such as Checkout Session completion.
  const priceId = subscription?.items?.data?.[0]?.price?.id;
  const priceTier = tierFromStripePriceId(priceId, env);
  if (priceTier) return priceTier;

  return normalizeTier(subscription?.metadata?.tier);
}

function userIdFromObject(object) {
  const value = object?.metadata?.user_id || object?.client_reference_id;
  return /^\d+$/.test(String(value || "")) ? Number(value) : null;
}

// Never let editable metadata move an already-bound subscription to another
// account. Stable Steam identity also protects against recycled local IDs.
function resolveUser(object, subscriptionId) {
  const known = existingBySubscription(subscriptionId);
  const metadataId = userIdFromObject(object);
  const steam = String(object?.metadata?.steam_id || "");
  const steamUser = steam ? db.prepare("SELECT id FROM users WHERE steam_id = ?").get(steam) : null;
  const userId = known?.user_id || steamUser?.id || metadataId;
  if (!userId) return null;
  const user = db.prepare("SELECT id, steam_id FROM users WHERE id = ?").get(userId);
  if (!user || (steam && user.steam_id !== steam) ||
      (metadataId && metadataId !== userId) ||
      (known?.stripe_customer_id && normalizeId(object.customer) && known.stripe_customer_id !== normalizeId(object.customer))) {
    throw new Error("Stripe membership identity mismatch; account review required");
  }
  const customer = normalizeId(object.customer);
  if (customer && db.prepare("SELECT 1 FROM supporter_subscriptions WHERE stripe_customer_id = ? AND user_id != ?").get(customer, userId)) {
    throw new Error("Stripe customer is linked to a different account");
  }
  return userId;
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
  add("renewal_mode", "TEXT NOT NULL DEFAULT 'auto_renew'");
  add("stripe_last_event_created", "INTEGER NOT NULL DEFAULT 0");
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
  renewalMode = "auto_renew",
}) {
  const canonicalTier = normalizeTier(tier);
  if (!userId || !canonicalTier || !Object.hasOwn(TIERS, canonicalTier)) return null;
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!user) return null;
  const current = getSupporterStatus(userId);
  // Stripe cancellation is terminal for this subscription ID. A delayed
  // checkout or subscription update must not revive it; a genuinely new
  // subscription uses a different ID and remains eligible for activation.
  if (subscriptionId && current?.stripe_subscription_id === subscriptionId &&
      ["canceled", "incomplete_expired"].includes(current.stripe_status) &&
      !["canceled", "incomplete_expired"].includes(status)) return current;
  if (subscriptionId && current?.stripe_subscription_id && current.stripe_subscription_id !== subscriptionId &&
      ["canceled", "incomplete_expired"].includes(status)) return current;

  db.prepare(`
    INSERT INTO supporter_subscriptions (
      user_id, tier, auto_renew, renews_at, cancelled_at,
      stripe_customer_id, stripe_subscription_id, stripe_status, renewal_mode
    )
    VALUES (?, ?, ?, ?, CASE WHEN ? = 1 THEN NULL ELSE datetime('now') END, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      tier = excluded.tier,
      auto_renew = excluded.auto_renew,
      renews_at = COALESCE(excluded.renews_at, supporter_subscriptions.renews_at),
      cancelled_at = CASE WHEN excluded.auto_renew = 1 THEN NULL ELSE COALESCE(supporter_subscriptions.cancelled_at, datetime('now')) END,
      stripe_customer_id = COALESCE(excluded.stripe_customer_id, supporter_subscriptions.stripe_customer_id),
      stripe_subscription_id = COALESCE(excluded.stripe_subscription_id, supporter_subscriptions.stripe_subscription_id),
      stripe_status = excluded.stripe_status,
      renewal_mode = excluded.renewal_mode
  `).run(
    userId,
    canonicalTier,
    autoRenew ? 1 : 0,
    renewsAt,
    autoRenew ? 1 : 0,
    customerId,
    subscriptionId,
    status,
    renewalMode === "one_month" ? "one_month" : "auto_renew"
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

function processStripeEvent(event, env = process.env, options = {}) {
  db.exec("SAVEPOINT supporter_lifecycle");
  try {
    const result = applyStripeEvent(event, env, options);
    db.exec("RELEASE supporter_lifecycle");
    return result;
  } catch (error) {
    db.exec("ROLLBACK TO supporter_lifecycle; RELEASE supporter_lifecycle");
    throw error;
  }
}

function applyStripeEvent(event, env = process.env, { authoritative = false } = {}) {
  const expectedLive = liveModeEnabled(env);
  if (!event?.id || !event?.type || event.livemode !== expectedLive) return { ignored: true };
  const duplicate = alreadyProcessed(event.id);
  if (duplicate && !authoritative) return { duplicate: true };

  const object = event.data?.object || {};
  let affectedUserId = null;
  const eventSubscriptionId = event.type.startsWith("customer.subscription.") ? normalizeId(object.id) :
    event.type === "checkout.session.completed" ? normalizeId(object.subscription) :
    event.type.startsWith("invoice.") ? invoiceSubscriptionId(object) : null;
  const eventUserId = resolveUser(object, eventSubscriptionId);
  const currentMembership = eventUserId ? getSupporterStatus(eventUserId) : null;
  const eventCreated = Number(event.created) || 0;
  if (eventCreated > 0 && Number(currentMembership?.stripe_last_event_created || 0) > eventCreated) {
    recordProcessed(event);
    return { processed: true, userId: currentMembership.user_id, stale: true };
  }

  if (event.type === "checkout.session.completed") {
    if (object.mode === "subscription") {
      const userId = eventUserId;
      const tier = normalizeTier(object.metadata?.tier);
      const paid = object.payment_status === "paid" || object.payment_status === "no_payment_required";
      if (userId && tier) {
        const updated = upsertSupporter({
          userId,
          tier,
          customerId: normalizeId(object.customer),
          subscriptionId: normalizeId(object.subscription),
          status: paid ? "active" : "pending",
          autoRenew: true,
        });
        affectedUserId = updated?.user_id || userId;
      }
    }
  } else if (["customer.subscription.created", "customer.subscription.updated"].includes(event.type)) {
    const subscriptionId = normalizeId(object.id);
    const existing = existingBySubscription(subscriptionId);
    const userId = eventUserId;
    const tier = tierFromSubscription(object, env) || existing?.tier || null;
    const autoRenew = !object.cancel_at_period_end && object.status !== "canceled";
    if (userId && tier) {
      const updated = upsertSupporter({
        userId,
        tier,
        customerId: normalizeId(object.customer),
        subscriptionId,
        status: object.status || "unknown",
        renewsAt: isoFromUnix(subscriptionPeriodEnd(object)),
        autoRenew,
        renewalMode: object.metadata?.renewal_mode,
      });
      affectedUserId = updated?.user_id || userId;
    }
  } else if (event.type === "customer.subscription.deleted") {
    const subscriptionId = normalizeId(object.id);
    const existing = existingBySubscription(subscriptionId);
    const userId = eventUserId;
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
      const updated = markBySubscription(subscriptionId, {
        status: "canceled",
        autoRenew: false,
        renewsAt: isoFromUnix(subscriptionPeriodEnd(object)),
        cancelled: true,
      });
      affectedUserId = updated?.user_id || userId;
    }
  } else if (event.type === "invoice.paid") {
    const subscriptionId = invoiceSubscriptionId(object);
    if (subscriptionId) {
      const existing = existingBySubscription(subscriptionId);
      // A delayed paid invoice records history but cannot resurrect a
      // subscription whose termination has already been confirmed by Stripe.
      if (existing && ["canceled", "incomplete_expired"].includes(existing.stripe_status)) {
        recordProcessed(event);
        return { processed: true, userId: existing.user_id };
      }
      const periodEnd = object.lines?.data?.reduce((latest, line) => {
        const end = Number(line?.period?.end) || 0;
        return Math.max(latest, end);
      }, 0);
      const updated = markBySubscription(subscriptionId, {
        status: "active",
        renewsAt: isoFromUnix(periodEnd),
      });
      affectedUserId = updated?.user_id || null;
    }
  } else if (event.type === "invoice.payment_failed") {
    const subscriptionId = invoiceSubscriptionId(object);
    if (subscriptionId) {
      const existing = existingBySubscription(subscriptionId);
      if (existing && !["canceled", "incomplete_expired"].includes(existing.stripe_status)) {
        const updated = markBySubscription(subscriptionId, {
          status: "past_due",
        });
        affectedUserId = updated?.user_id || existing.user_id || null;
      }
    }
  }

  if (affectedUserId && eventSubscriptionId && eventCreated > 0) {
    db.prepare(`UPDATE supporter_subscriptions SET stripe_last_event_created = MAX(stripe_last_event_created, ?)
      WHERE user_id = ? AND stripe_subscription_id = ?`).run(eventCreated, affectedUserId, eventSubscriptionId);
  }
  recordProcessed(event);
  return { processed: true, userId: affectedUserId, ...(duplicate ? { duplicate: true } : {}) };
}

function isEntitled(status, now = Date.now()) {
  if (typeof status === "string") return ACTIVE_STATUSES.has(status);
  const until = require("./membershipEntitlements").timestamp(status?.renews_at);
  return Boolean(status && status.stripe_status === "active" && until !== null && until > now);
}

// Supporters may retain paid access until the end of a billing period after
// cancelling renewal. Bonus Valley Coins stop as soon as cancellation is
// confirmed, regardless of whether Stripe still reports "active". A one-month
// purchase intentionally has no renewal; its coin benefits last the paid month.
function isCoinBonusEligible(row) {
  return Boolean(row && isEntitled(row) &&
    (row.renewal_mode === "one_month" || (Number(row.auto_renew) === 1 && !row.cancelled_at)));
}

module.exports = {
  verifyStripeSignature,
  processStripeEvent,
  tierFromSubscription,
  isEntitled,
  isCoinBonusEligible,
  upsertSupporter,
  subscriptionPeriodEnd,
  resolveUser,
  _test: {
    parseStripeSignature,
    isoFromUnix,
    subscriptionPeriodEnd,
    invoiceSubscriptionId,
    upsertSupporter,
    existingBySubscription,
  },
};
