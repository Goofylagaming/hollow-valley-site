"use strict";

const { randomUUID } = require("node:crypto");
const { db, getSupporterStatus } = require("../db");
const { normalizeTier, tierInfo, tierFromStripePriceId } = require("./supporterTiers");
const { BENEFITS, enabled, entitlement } = require("./membershipEntitlements");
const { liveModeEnabled } = require("./supporterCheckout");

const MILESTONES = Object.freeze([
  Object.freeze({ months: 3, title: "Valley Companion", frameId: "loyalty-3" }),
  Object.freeze({ months: 6, title: "Ancient Guardian", frameId: "loyalty-6" }),
  Object.freeze({ months: 12, title: "Heart of the Valley", frameId: "loyalty-12" }),
]);
const FRAMES = Object.freeze([
  Object.freeze({ id: "none", label: "Classic", permanent: true }),
  Object.freeze({ id: "supporter-fern", label: "Fern", tier: "supporter" }),
  Object.freeze({ id: "guardian-river", label: "River", tier: "guardian" }),
  Object.freeze({ id: "legend-gold", label: "Valley Gold", tier: "legend" }),
  ...MILESTONES.map(m => Object.freeze({ id: m.frameId, label: m.title, months: m.months, permanent: true })),
]);

class MembershipError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function ensureSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS membership_paid_invoices (
      invoice_id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      subscription_id TEXT NOT NULL,
      tier TEXT NOT NULL,
      period_start INTEGER NOT NULL,
      period_end INTEGER NOT NULL,
      billing_reason TEXT NOT NULL,
      amount_paid INTEGER NOT NULL,
      paid_at TEXT NOT NULL,
      counts_month INTEGER NOT NULL DEFAULT 0,
      revoked INTEGER NOT NULL DEFAULT 0,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_membership_invoices_user ON membership_paid_invoices(user_id, subscription_id);
    CREATE TABLE IF NOT EXISTS membership_refunded_invoices (
      invoice_id TEXT PRIMARY KEY,
      revoked_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS membership_refunded_payments (
      payment_ref TEXT PRIMARY KEY,
      revoked_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS membership_invoice_payment_refs (
      invoice_id TEXT NOT NULL,
      payment_ref TEXT NOT NULL,
      PRIMARY KEY(invoice_id, payment_ref)
    );
    CREATE TABLE IF NOT EXISTS membership_reward_periods (
      period_key TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      subscription_id TEXT NOT NULL,
      period_start INTEGER NOT NULL,
      period_end INTEGER NOT NULL,
      tier TEXT NOT NULL,
      allowance INTEGER NOT NULL,
      source_invoice_id TEXT NOT NULL,
      UNIQUE(user_id, subscription_id, period_start, period_end)
    );
    CREATE TABLE IF NOT EXISTS membership_loyalty_rewards (
      user_id INTEGER NOT NULL REFERENCES users(id),
      months INTEGER NOT NULL,
      title TEXT NOT NULL,
      frame_id TEXT NOT NULL,
      earned_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(user_id, months)
    );
    CREATE TABLE IF NOT EXISTS membership_appearance (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      frame_id TEXT NOT NULL DEFAULT 'none',
      badge_visible INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS membership_skin_claims (
      claim_id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      steam_id TEXT NOT NULL,
      period_key TEXT NOT NULL,
      skin_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','fulfilled','released')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, skin_id)
    );
    CREATE INDEX IF NOT EXISTS idx_membership_claims_period ON membership_skin_claims(user_id, period_key, status);
    CREATE TABLE IF NOT EXISTS membership_history_sync (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      synced_at TEXT NOT NULL,
      complete INTEGER NOT NULL DEFAULT 0
    );
  `);
}

function id(value) { return typeof value === "string" ? value : value?.id || null; }
function invoiceSubscriptionId(invoice) {
  return id(invoice?.subscription || invoice?.parent?.subscription_details?.subscription ||
    invoice?.lines?.data?.[0]?.parent?.subscription_item_details?.subscription);
}
function priceId(line) { return id(line?.price || line?.pricing?.price_details?.price); }
function lineProration(line) { return line?.proration === true || line?.parent?.subscription_item_details?.proration === true; }

function paidMonths(userId, now = Date.now()) {
  ensureSchema();
  const rows = db.prepare(`SELECT p.period_start, p.period_end FROM membership_reward_periods p
    JOIN membership_paid_invoices i ON i.invoice_id = p.source_invoice_id
    WHERE p.user_id = ? AND p.period_start <= ? AND i.revoked = 0
    ORDER BY p.period_start, p.period_end`).all(userId, now);
  // Replaced subscriptions and duplicate paid invoices cannot stack overlapping
  // periods into several loyalty months.
  let end = -Infinity;
  let months = 0;
  for (const row of rows) {
    if (row.period_start >= end) { months += 1; end = row.period_end; }
  }
  return months;
}

function awardLoyalty(userId, now = Date.now()) {
  const months = paidMonths(userId, now);
  for (const reward of MILESTONES) {
    if (months >= reward.months) db.prepare(`INSERT OR IGNORE INTO membership_loyalty_rewards
      (user_id, months, title, frame_id) VALUES (?, ?, ?, ?)`).run(userId, reward.months, reward.title, reward.frameId);
  }
  return months;
}

function rebuildPeriodAllowances(userId, subscriptionId) {
  const periods = db.prepare(`SELECT * FROM membership_reward_periods WHERE user_id = ? AND subscription_id = ?`).all(userId, subscriptionId);
  for (const period of periods) {
    const invoices = db.prepare(`SELECT tier FROM membership_paid_invoices WHERE user_id = ? AND subscription_id = ?
      AND period_start >= ? AND period_end <= ? AND revoked = 0`).all(userId, subscriptionId, period.period_start, period.period_end);
    const base = db.prepare("SELECT tier, revoked FROM membership_paid_invoices WHERE invoice_id = ?").get(period.source_invoice_id);
    let bestTier = base?.tier || period.tier;
    let allowance = base && !base.revoked ? BENEFITS[bestTier]?.monthlySkinChoices || 0 : 0;
    for (const invoice of invoices) {
      const choices = BENEFITS[invoice.tier]?.monthlySkinChoices || 0;
      if (base && !base.revoked && choices > allowance) { allowance = choices; bestTier = invoice.tier; }
    }
    db.prepare("UPDATE membership_reward_periods SET tier = ?, allowance = ? WHERE period_key = ?")
      .run(bestTier, allowance, period.period_key);
  }
}

function recordPaidInvoice(invoice, { env = process.env, now = Date.now(), expectedUserId = null } = {}) {
  if (!enabled(env)) return { skipped: true, reason: "disabled" };
  if (invoice?.livemode !== liveModeEnabled(env)) return { skipped: true, reason: "wrong-mode" };
  if (!(invoice?.status === "paid" || invoice?.paid === true) || !(Number(invoice?.amount_paid) > 0)) {
    return { skipped: true, reason: "no-paid-invoice" };
  }
  const billingReason = String(invoice.billing_reason || "");
  if (!["subscription_create", "subscription_cycle", "subscription_update"].includes(billingReason)) {
    return { skipped: true, reason: "not-membership-billing" };
  }
  const invoiceId = String(invoice.id || "");
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!/^in_[A-Za-z0-9_]+$/.test(invoiceId) || !/^sub_[A-Za-z0-9_]+$/.test(subscriptionId || "")) {
    throw new MembershipError(502, "INVALID_INVOICE", "The paid membership invoice could not be verified.");
  }
  ensureSchema();
  const existing = db.prepare("SELECT user_id, subscription_id FROM membership_paid_invoices WHERE invoice_id = ?").get(invoiceId);
  if (existing) {
    if (existing.subscription_id !== subscriptionId || (expectedUserId !== null && existing.user_id !== expectedUserId)) {
      throw new MembershipError(409, "INVOICE_OWNER_MISMATCH", "This invoice is already linked to another account.");
    }
    if (invoice._membershipFunding?.revoked === true) revokeInvoice(invoiceId);
    return { duplicate: true, userId: existing.user_id };
  }
  const subscriber = db.prepare("SELECT * FROM supporter_subscriptions WHERE stripe_subscription_id = ?").get(subscriptionId);
  if (!subscriber || (expectedUserId !== null && subscriber.user_id !== expectedUserId)) {
    throw new MembershipError(503, "MEMBERSHIP_NOT_LINKED", "The paid subscription is not linked to this account yet.");
  }
  if (invoice.lines?.has_more) throw new MembershipError(503, "INVOICE_LINES_INCOMPLETE", "The complete membership invoice is required before rewards can be recorded.");
  const lines = (invoice.lines?.data || []).map(line => ({ line, tier: tierFromStripePriceId(priceId(line), env) }))
    .filter(({ line, tier }) => tier && Number(line.amount) > 0 &&
      (!id(line.subscription || line.parent?.subscription_item_details?.subscription) ||
       id(line.subscription || line.parent?.subscription_item_details?.subscription) === subscriptionId));
  if (!lines.length) return { skipped: true, reason: "no-recognized-membership-price" };
  // Current plans contain one monthly membership item. Ambiguous invoices need
  // review instead of guessing a paid tier from mutable subscription metadata.
  const candidates = billingReason === "subscription_update" ? lines : lines.filter(({ line }) => !lineProration(line));
  if (!candidates.length) return { skipped: true, reason: "no-full-membership-line" };
  const chosen = candidates.sort((a, b) => BENEFITS[b.tier].monthlySkinChoices - BENEFITS[a.tier].monthlySkinChoices)[0];
  const start = Number(chosen.line.period?.start) * 1000;
  const end = Number(chosen.line.period?.end) * 1000;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start <= 0 || end <= start) {
    throw new MembershipError(502, "INVALID_PAID_PERIOD", "The membership billing period could not be verified.");
  }
  const days = (end - start) / 86400000;
  const recurring = chosen.line.price?.recurring;
  const monthly = !recurring || (recurring.interval === "month" && Number(recurring.interval_count || 1) === 1);
  const countsMonth = billingReason !== "subscription_update" && !lineProration(chosen.line) && monthly && days >= 27 && days <= 32;
  const paidAtMs = Number(invoice.status_transitions?.paid_at || invoice.created) * 1000;
  const paidAt = new Date(Number.isFinite(paidAtMs) && paidAtMs > 0 ? paidAtMs : now).toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`INSERT INTO membership_paid_invoices
      (invoice_id, user_id, subscription_id, tier, period_start, period_end, billing_reason, amount_paid, paid_at, counts_month)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(invoiceId, subscriber.user_id, subscriptionId, chosen.tier, start, end,
        billingReason, Math.floor(Number(invoice.amount_paid)), paidAt, countsMonth ? 1 : 0);
    const refs = Array.isArray(invoice._membershipFunding?.references) ? invoice._membershipFunding.references : [];
    for (const paymentRef of refs.filter(value => /^(charge:ch_|payment_intent:pi_)[A-Za-z0-9_]+$/.test(value))) {
      db.prepare("INSERT OR IGNORE INTO membership_invoice_payment_refs(invoice_id, payment_ref) VALUES (?, ?)").run(invoiceId, paymentRef);
    }
    const paymentRefunded = refs.some(value => db.prepare("SELECT 1 FROM membership_refunded_payments WHERE payment_ref = ?").get(value));
    if (invoice._membershipFunding?.revoked === true || paymentRefunded || db.prepare("SELECT 1 FROM membership_refunded_invoices WHERE invoice_id = ?").get(invoiceId)) {
      db.prepare("UPDATE membership_paid_invoices SET revoked = 1 WHERE invoice_id = ?").run(invoiceId);
    }
    if (countsMonth) {
      const periodKey = `${subscriptionId}:${start}:${end}`;
      db.prepare(`INSERT OR IGNORE INTO membership_reward_periods
        (period_key, user_id, subscription_id, period_start, period_end, tier, allowance, source_invoice_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(periodKey, subscriber.user_id, subscriptionId, start, end,
          chosen.tier, BENEFITS[chosen.tier].monthlySkinChoices, invoiceId);
    }
    rebuildPeriodAllowances(subscriber.user_id, subscriptionId);
    awardLoyalty(subscriber.user_id, now);
    if (env.MEMBERSHIP_COLLECTION_ENABLED === "1") require("./membershipVault").readVault(subscriber.user_id,now);
    db.exec("COMMIT");
  } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
  return { recorded: true, userId: subscriber.user_id, countsMonth };
}

function revokeInvoice(invoiceId) {
  ensureSchema();
  db.prepare("INSERT OR IGNORE INTO membership_refunded_invoices(invoice_id) VALUES (?)").run(invoiceId);
  db.prepare("UPDATE membership_paid_invoices SET revoked = 1 WHERE invoice_id = ?").run(invoiceId);
  const paid = db.prepare("SELECT user_id, subscription_id FROM membership_paid_invoices WHERE invoice_id = ?").get(invoiceId);
  if (paid) rebuildPeriodAllowances(paid.user_id, paid.subscription_id);
}

function processRewardEvent(event, { env = process.env, now = Date.now() } = {}) {
  if (event?.livemode !== liveModeEnabled(env)) return { skipped: true };
  if (event?.type === "invoice.paid") return recordPaidInvoice(event.data?.object, { env, now });
  // Permanent, already-earned cosmetics are retained. A fully refunded invoice
  // stops funding new choices or contributing to future loyalty milestones.
  if (event?.type === "charge.refunded" && event.data?.object?.refunded === true) {
    ensureSchema();
    const invoiceId = id(event.data.object.invoice);
    const paymentRefs = [];
    if (/^ch_[A-Za-z0-9_]+$/.test(event.data.object.id || "")) paymentRefs.push(`charge:${event.data.object.id}`);
    if (/^pi_[A-Za-z0-9_]+$/.test(id(event.data.object.payment_intent) || "")) paymentRefs.push(`payment_intent:${id(event.data.object.payment_intent)}`);
    // Keep tombstones even while new rewards are switched off, so a later
    // backfill cannot accidentally turn refunded payments into paid months.
    for (const paymentRef of paymentRefs) {
      db.prepare("INSERT OR IGNORE INTO membership_refunded_payments(payment_ref) VALUES (?)").run(paymentRef);
      for (const row of db.prepare("SELECT invoice_id FROM membership_invoice_payment_refs WHERE payment_ref = ?").all(paymentRef)) revokeInvoice(row.invoice_id);
    }
    if (invoiceId && /^in_[A-Za-z0-9_]+$/.test(invoiceId)) {
      revokeInvoice(invoiceId);
    }
    return { processed: Boolean(invoiceId) };
  }
  return { skipped: true };
}

function currentPeriod(userId, { env = process.env, now = Date.now() } = {}) {
  const status = getSupporterStatus(userId);
  if (!entitlement(status, { env, now }).entitled) return null;
  ensureSchema();
  return db.prepare(`SELECT p.* FROM membership_reward_periods p
    JOIN membership_paid_invoices i ON i.invoice_id = p.source_invoice_id
    WHERE p.user_id = ? AND p.subscription_id = ? AND p.period_start <= ? AND p.period_end > ? AND i.revoked = 0
    ORDER BY p.period_start DESC LIMIT 1`).get(userId, status.stripe_subscription_id, now, now) || null;
}

function appearanceFor(userId, active, { now = Date.now() } = {}) {
  ensureSchema();
  const earned = db.prepare("SELECT * FROM membership_loyalty_rewards WHERE user_id = ?").all(userId);
  const months = new Set(earned.map(row => row.months));
  const rank = active.entitled ? BENEFITS[active.tier].monthlySkinChoices : 0;
  const frames = FRAMES.map(frame => ({
    ...frame,
    available: frame.id === "none" || (frame.months ? months.has(frame.months) : rank >= BENEFITS[frame.tier].monthlySkinChoices),
    permanent: Boolean(frame.permanent),
  }));
  const selected = db.prepare("SELECT * FROM membership_appearance WHERE user_id = ?").get(userId);
  const frameId = frames.find(frame => frame.id === selected?.frame_id && frame.available)?.id || "none";
  return {
    badgeVisible: selected?.badge_visible !== 0,
    badge: active.entitled ? { id: active.tier, label: active.tierLabel } : null,
    frameId, selectedFrameId: frameId, frames,
  };
}

function loyaltySchedule(userId, membership, active, months, next, now) {
  const renewalAt = Date.parse(active.expiresAt);
  const available = active.entitled && Number.isFinite(renewalAt) && renewalAt > now;
  const autoRenew = available && Number(membership?.auto_renew) === 1;
  const latest = db.prepare(`SELECT p.period_start,p.period_end FROM membership_reward_periods p
    JOIN membership_paid_invoices i ON i.invoice_id=p.source_invoice_id
    WHERE p.user_id=? AND p.subscription_id=? AND i.revoked=0
    ORDER BY p.period_end DESC LIMIT 1`).get(userId, membership?.stripe_subscription_id || "");
  const remaining = next ? next.months - months : 0;
  let expectedUnlockAt = null;
  // Only extrapolate from a verified monthly cycle matching the paid-access end.
  if (available && remaining > 0 && latest?.period_end === renewalAt &&
      (latest.period_end - latest.period_start) / 86400000 >= 27 &&
      (latest.period_end - latest.period_start) / 86400000 <= 32) {
    const boundary = new Date(renewalAt);
    const anchorDay = Math.max(boundary.getUTCDate(), new Date(latest.period_start).getUTCDate());
    const targetMonth = boundary.getUTCMonth() + remaining - 1;
    const lastDay = new Date(Date.UTC(boundary.getUTCFullYear(), targetMonth + 1, 0)).getUTCDate();
    const expected = new Date(renewalAt);
    expected.setUTCDate(1);
    expected.setUTCMonth(targetMonth);
    expected.setUTCDate(Math.min(anchorDay, lastDay));
    expectedUnlockAt = expected.toISOString();
  }
  return {
    nextPaymentAt: autoRenew ? active.expiresAt : null,
    renewalDueAt: available && !autoRenew ? active.expiresAt : null,
    manualRenewalRequired: available && !autoRenew,
    expectedUnlockAt,
  };
}

function rewardSummary(user, { env = process.env, now = Date.now() } = {}) {
  if (!enabled(env)) return { enabled: false };
  ensureSchema();
  const membership = getSupporterStatus(user.id);
  const active = entitlement(membership, { env, now });
  const period = currentPeriod(user.id, { env, now });
  const claims = db.prepare(`SELECT claim_id AS id, skin_id AS skinId, status, period_key FROM membership_skin_claims
    WHERE user_id = ? AND status != 'released' ORDER BY created_at DESC`).all(user.id);
  const periodClaims = period ? claims.filter(claim => claim.period_key === period.period_key) : [];
  const months = paidMonths(user.id, now);
  const earned = db.prepare("SELECT months, earned_at FROM membership_loyalty_rewards WHERE user_id = ?").all(user.id);
  const milestones = MILESTONES.map(m => ({ ...m, earned: earned.some(e => e.months === m.months), earnedAt: earned.find(e => e.months === m.months)?.earned_at || null }));
  const history = db.prepare("SELECT synced_at, complete FROM membership_history_sync WHERE user_id = ?").get(user.id);
  const nextMilestone = milestones.find(m => !m.earned) || null;
  return {
    enabled: true, tier: active.tier, tierLabel: active.tierLabel,
    entitled: active.entitled, benefitsUntil: active.expiresAt,
    appearance: appearanceFor(user.id, active, { now }),
    monthly: {
      enabled: Boolean(period), allowance: period?.allowance || 0, used: periodClaims.length,
      remaining: Math.max(0, (period?.allowance || 0) - periodClaims.length),
      periodStart: period ? new Date(period.period_start).toISOString() : null,
      periodEnd: period ? new Date(period.period_end).toISOString() : null,
      catalogueReady: false,
      claims: claims.map(({ period_key, ...claim }) => ({ ...claim, currentPeriod: period?.period_key === period_key })),
    },
    loyalty: { paidMonths: months, milestones, nextMilestone,
      schedule: loyaltySchedule(user.id, membership, active, months, nextMilestone, now),
      historyVerified: months > 0 || Boolean(history?.complete), historySyncedAt: history?.synced_at || null,
      historyScope: "current-subscription-and-recorded-periods",
      canSyncHistory: Boolean(getSupporterStatus(user.id)?.stripe_subscription_id) },
    discord: { configured: Boolean(env.DISCORD_ROLE_BOT_TOKEN && /^\d{15,22}$/.test(env.DISCORD_GUILD_ID || "")),
      linked: Boolean(user.discord_id), roleName: active.tierLabel },
  };
}

function updateAppearance(user, input, options = {}) {
  if (!enabled(options.env)) throw new MembershipError(503, "REWARDS_DISABLED", "Membership customisation is being prepared.");
  const summary = rewardSummary(user, options);
  if (typeof input?.badgeVisible !== "boolean" || typeof input?.frameId !== "string") {
    throw new MembershipError(400, "INVALID_APPEARANCE", "Choose a frame and whether to display your badge.");
  }
  if (!summary.appearance.frames.some(frame => frame.id === input.frameId && frame.available)) {
    throw new MembershipError(403, "FRAME_NOT_OWNED", "This profile frame is not available to your account.");
  }
  db.prepare(`INSERT INTO membership_appearance(user_id, frame_id, badge_visible) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET frame_id = excluded.frame_id, badge_visible = excluded.badge_visible, updated_at = datetime('now')`)
    .run(user.id, input.frameId, input.badgeVisible ? 1 : 0);
  return rewardSummary(user, options);
}

function finishSkinClaim(claim,state) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const changed=db.prepare("UPDATE membership_skin_claims SET status=?, updated_at=datetime('now') WHERE claim_id=? AND status='pending'").run(state,claim.claim_id).changes;
    if(changed && state==="released" && claim.period_key.startsWith("bonus-token:")) {
      db.prepare("UPDATE membership_bonus_claim_tokens SET redeemed_at=NULL WHERE grant_key=? AND user_id=?").run(claim.period_key.slice(12),claim.user_id);
    }
    db.exec("COMMIT");
  } catch(e){db.exec("ROLLBACK");throw e;}
}

async function claimSkin(user, skinId, { env = process.env, now = Date.now(), client = null } = {}) {
  if (!/^\d{17}$/.test(String(user?.steam_id || ""))) throw new MembershipError(409, "STEAM_LINK_REQUIRED", "Link Steam before choosing a membership skin.");
  if (typeof skinId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(skinId)) throw new MembershipError(400, "INVALID_SKIN", "Choose a valid membership skin.");
  ensureSchema();
  const api = client || require("./premiumSkinClient");
  let claim = db.prepare("SELECT * FROM membership_skin_claims WHERE user_id = ? AND skin_id = ?").get(user.id, skinId);
  if (claim?.status === "fulfilled") return { ok: true, duplicate: true, claimId: claim.claim_id, skinId };
  if (claim?.status === "pending" && claim.steam_id !== String(user.steam_id)) {
    throw new MembershipError(409, "CLAIM_ACCOUNT_CHANGED", "This pending choice belongs to the previously linked Steam account. Contact an admin.");
  }
  if (!claim || claim.status === "released") {
    if (!enabled(env)) throw new MembershipError(503, "REWARDS_DISABLED", "Membership skin choices are being prepared.");
    const catalogue = await api.listCatalog(String(user.steam_id));
    const skin = catalogue?.skins?.find(entry => String(entry.id) === skinId);
    if (!catalogue?.enabled || !skin) throw new MembershipError(409, "SKIN_NOT_AVAILABLE", "This skin is not ready for membership choices yet.");
    if (skin.owned) return { ok: true, alreadyOwned: true, skinId };
    db.exec("BEGIN IMMEDIATE");
    try {
      // Re-read after the network wait; a simultaneous request may already
      // have reserved this choice or consumed the last slot.
      claim = db.prepare("SELECT * FROM membership_skin_claims WHERE user_id = ? AND skin_id = ?").get(user.id, skinId);
      if (!claim || claim.status === "released") {
        const period = currentPeriod(user.id, { env, now });
        let periodKey = period?.period_key;
        const used = period ? db.prepare("SELECT COUNT(*) AS count FROM membership_skin_claims WHERE user_id = ? AND period_key = ? AND status != 'released'").get(user.id,periodKey).count : 0;
        if (!period || used >= period.allowance) {
          let token;
          if (env.MEMBERSHIP_GROWTH_ENABLED === "1") {
            require("./membershipGrowth").migrateGrowth(db);
            token = db.prepare(`SELECT grant_key FROM membership_bonus_claim_tokens WHERE user_id=?
              AND redeemed_at IS NULL AND (expires_at IS NULL OR expires_at>?)
              ORDER BY expires_at IS NULL,expires_at,granted_at,grant_key LIMIT 1`).get(user.id,now);
          }
          if (!token && !period) throw new MembershipError(409, "PAID_PERIOD_REQUIRED", "Verify your paid membership history before choosing a monthly skin.");
          if (!token) throw new MembershipError(409, "MONTHLY_CHOICES_USED", "You have used this billing period's skin choices.");
          db.prepare("UPDATE membership_bonus_claim_tokens SET redeemed_at=? WHERE grant_key=?").run(now,token.grant_key);
          periodKey = "bonus-token:" + token.grant_key;
        }
        const claimId = randomUUID();
        db.prepare(`INSERT INTO membership_skin_claims(claim_id, user_id, steam_id, period_key, skin_id, status)
          VALUES (?, ?, ?, ?, ?, 'pending') ON CONFLICT(user_id, skin_id) DO UPDATE SET
          claim_id = excluded.claim_id, steam_id = excluded.steam_id, period_key = excluded.period_key,
          status = 'pending', updated_at = datetime('now')`).run(claimId, user.id, String(user.steam_id), periodKey, skinId);
        claim = db.prepare("SELECT * FROM membership_skin_claims WHERE claim_id = ?").get(claimId);
      }
      db.exec("COMMIT");
    } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
  }
  if (claim.status === "fulfilled") return { ok: true, duplicate: true, claimId: claim.claim_id, skinId };
  try {
    const result = await api.fulfillClaim({ claimId: claim.claim_id, steamId: claim.steam_id, skinId });
    if (!result || result.claimId !== claim.claim_id || result.skinId !== skinId ||
        typeof result.presetId !== "string" || !result.presetId || typeof result.alreadyOwned !== "boolean") {
      throw new Error("Membership skin receipt could not be verified");
    }
    const state = result?.alreadyOwned === true ? "released" : "fulfilled";
    finishSkinClaim(claim,state);
    return { ok: true, claimId: claim.claim_id, skinId, alreadyOwned: result?.alreadyOwned === true, duplicate: Boolean(result?.duplicate) };
  } catch (error) {
    // Unknown delivery outcomes retain the same reservation and claim ID.
    // A retry must ask the automation receipt ledger, never grant a new skin.
    if ([400, 403, 404].includes(error?.status) || error?.code === "PREMIUM_SKIN_UNAVAILABLE") {
      finishSkinClaim(claim,"released");
      throw new MembershipError(error.status, "SKIN_NOT_AVAILABLE", "This skin is no longer available. Your choice has been returned.");
    }
    throw new MembershipError(503, "SKIN_CHOICE_PENDING", "Your skin choice is reserved. Retry this same skin to finish delivery; it will not use another choice.");
  }
}

module.exports = { BENEFITS, MILESTONES, FRAMES, MembershipError, ensureSchema, enabled, entitlement,
  invoiceSubscriptionId, recordPaidInvoice, processRewardEvent, paidMonths, awardLoyalty,
  currentPeriod, rewardSummary, updateAppearance, claimSkin, revokeInvoice };
