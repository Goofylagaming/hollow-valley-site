"use strict";

const { getSupporterStatus } = require("../db");
const { liveModeEnabled } = require("./supporterCheckout");
const { ensureOneMonthEnd, serializeMembershipOperation } = require("./supporterRenewal");
const { processStripeEvent, resolveUser, _test: { invoiceSubscriptionId } } = require("./supporterWebhook");
const ref = value => typeof value === "string" ? value : value?.id;
const TYPES = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded",
  "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted",
  "invoice.paid", "invoice.payment_failed"]);

// Serialize read/apply pairs in this SQLite process so two HTTP deliveries
// cannot apply Stripe snapshots in reverse order across an await.
function processLifecycle(event, options = {}) {
  return serializeMembershipOperation(() => reconcile(event, options));
}

async function reconcile(event, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const live = liveModeEnabled(env);
  if (event?.livemode !== live) return { ignored: true };
  if (!TYPES.has(event?.type)) return processStripeEvent(event, env);
  const object = event.data?.object || {};
  if (event.type.startsWith("checkout.") && object.mode !== "subscription") return { ignored: true };
  const subscriptionId = event.type.startsWith("customer.subscription.") ? ref(object.id) :
    event.type.startsWith("invoice.") ? invoiceSubscriptionId(object) : ref(object.subscription);
  if (!subscriptionId) return { ignored: true };
  const secret = String(env.STRIPE_SECRET_KEY || "");
  if (!(live ? /^(sk|rk)_live_/ : /^(sk|rk)_test_/).test(secret)) throw new Error("Stripe lifecycle verification is not configured");
  async function retrieve(id) {
    if (!/^sub_[A-Za-z0-9_]+$/.test(id)) throw new Error("Invalid subscription reference");
    const response = await fetchImpl(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("Stripe lifecycle verification unavailable");
    const subscription = await response.json();
    if (subscription.id !== id || subscription.livemode !== live) throw new Error("Stripe subscription verification mismatch");
    return subscription;
  }
  let subscription = await retrieve(subscriptionId);
  if (ref(object.customer) && ref(object.customer) !== ref(subscription.customer)) throw new Error("Stripe event customer mismatch");
  const userId = resolveUser(subscription, subscription.id);
  if (!userId) throw new Error("Stripe subscription has no verified Hollow Valley account");
  // Validate Checkout's account reference as well as the subscription metadata.
  if (event.type.startsWith("checkout.") && resolveUser(object, subscription.id) !== userId) throw new Error("Stripe checkout account mismatch");
  await ensureOneMonthEnd(subscription, { secret, fetchImpl });
  if (subscription.metadata?.renewal_mode === "one_month") {
    // Read again: a concurrent explicit renewal change may have superseded
    // the initial cancellation request or an idempotent replay response.
    subscription = await retrieve(subscriptionId);
    if (resolveUser(subscription, subscription.id) !== userId) throw new Error("Stripe renewal account mismatch");
    if (subscription.status === "active" && subscription.metadata?.renewal_mode === "one_month" &&
        !subscription.cancel_at_period_end) throw new Error("One-month renewal is still pending");
  }
  const current = getSupporterStatus(userId);
  if (current?.stripe_subscription_id && current.stripe_subscription_id !== subscription.id) {
    const previous = await retrieve(current.stripe_subscription_id);
    if (resolveUser(previous, previous.id) !== userId) throw new Error("Stripe existing account mismatch");
    // A failed or deleted old subscription must never displace a paid one.
    // Preserve the currently selected active subscription if both are active.
    if (previous.status === "active" || subscription.status !== "active") subscription = previous;
  }
  // Invoice events are signals to read current state, not commands to activate
  // or revoke. This also resolves equal-second and out-of-order deliveries.
  const result = processStripeEvent({ ...event, created: 0,
    type: "customer.subscription.updated", data: { object: subscription } }, env, { authoritative: true });
  return { ...result, userId, superseded: subscription.id !== subscriptionId };
}

module.exports = { processLifecycle };
