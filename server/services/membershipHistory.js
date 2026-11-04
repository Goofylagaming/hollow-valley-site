"use strict";

const { db, getSupporterStatus } = require("../db");
const { liveModeEnabled } = require("./supporterCheckout");
const rewards = require("./membershipRewards");
const { verifyInvoiceFunding } = require("./membershipPaymentVerification");

const inFlight = new Set();

async function syncPaidHistory(userId, { env = process.env, fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  if (!rewards.enabled(env)) throw new rewards.MembershipError(503, "REWARDS_DISABLED", "Membership rewards are being prepared.");
  const membership = getSupporterStatus(userId);
  const subscriptionId = membership?.stripe_subscription_id;
  if (!/^sub_[A-Za-z0-9_]+$/.test(subscriptionId || "")) {
    throw new rewards.MembershipError(409, "SUBSCRIPTION_REQUIRED", "Recover your Stripe membership before verifying paid history.");
  }
  const live = liveModeEnabled(env);
  const secret = String(env.STRIPE_SECRET_KEY || "");
  if (!(live ? /^(sk|rk)_live_/ : /^(sk|rk)_test_/).test(secret)) {
    throw new rewards.MembershipError(503, "HISTORY_NOT_CONFIGURED", "Paid membership history is not configured yet.");
  }
  rewards.ensureSchema();
  const previous = db.prepare("SELECT synced_at FROM membership_history_sync WHERE user_id = ?").get(userId);
  if (previous && now - Date.parse(previous.synced_at) < 60000) {
    throw new rewards.MembershipError(429, "HISTORY_RECENTLY_CHECKED", "Your paid history was just checked. Please wait a minute before checking again.");
  }
  if (inFlight.has(userId)) throw new rewards.MembershipError(409, "HISTORY_IN_PROGRESS", "Your paid history is already being checked.");
  inFlight.add(userId);
  try {
    let cursor = null;
    let complete = false;
    let recorded = 0;
    let duplicates = 0;
    let skipped = 0;
    let unresolved = 0;
    for (let page = 0; page < 10; page += 1) {
      const params = new URLSearchParams({ subscription: subscriptionId, status: "paid", limit: "100" });
      if (cursor) params.set("starting_after", cursor);
      const response = await fetchImpl(`https://api.stripe.com/v1/invoices?${params}`, {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new rewards.MembershipError(502, "HISTORY_UNAVAILABLE", "Stripe paid history is unavailable. Please try again later.");
      const payload = await response.json();
      if (!Array.isArray(payload?.data)) throw new rewards.MembershipError(502, "HISTORY_INVALID", "Stripe returned an incomplete paid history.");
      for (const invoice of payload.data) {
        if (rewards.invoiceSubscriptionId(invoice) !== subscriptionId || invoice.livemode !== live) {
          throw new rewards.MembershipError(502, "HISTORY_IDENTITY_MISMATCH", "The invoice could not be matched to your membership.");
        }
        if (!(Number(invoice.amount_paid) > 0)) { skipped += 1; continue; }
        const funding = await verifyInvoiceFunding(invoice, { env, fetchImpl });
        if (!funding.verified) { unresolved += 1; continue; }
        const result = rewards.recordPaidInvoice({ ...invoice, _membershipFunding: funding }, { env, now, expectedUserId: userId });
        if (result.recorded) recorded += 1;
        else if (result.duplicate) duplicates += 1;
        else skipped += 1;
      }
      if (!payload.has_more) { complete = unresolved === 0; break; }
      const next = String(payload.data.at(-1)?.id || "");
      if (!/^in_[A-Za-z0-9_]+$/.test(next) || next === cursor) throw new rewards.MembershipError(502, "HISTORY_INCOMPLETE", "The remaining paid history could not be checked.");
      cursor = next;
    }
    db.prepare(`INSERT INTO membership_history_sync(user_id, synced_at, complete) VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET synced_at = excluded.synced_at, complete = excluded.complete`)
      .run(userId, new Date(now).toISOString(), complete ? 1 : 0);
    return { recorded, duplicates, skipped, unresolved, complete, scope: "current-subscription-and-recorded-periods" };
  } catch (error) {
    if (error instanceof rewards.MembershipError) throw error;
    throw new rewards.MembershipError(502, "HISTORY_UNAVAILABLE", "Paid history could not be verified. Any verified records are saved; you can retry safely.");
  } finally { inFlight.delete(userId); }
}

module.exports = { syncPaidHistory };
