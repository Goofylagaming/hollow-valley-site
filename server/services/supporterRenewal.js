"use strict";

// Share the lifecycle lock with explicit renewal changes. Otherwise a webhook
// that read "one month" just before resume could turn renewal off again.
let tail = Promise.resolve();
function serializeMembershipOperation(operation) {
  const job = tail.then(operation);
  tail = job.catch(() => {});
  return job;
}

// Checkout cannot set cancel_at_period_end. Persist the choice on the Stripe
// subscription and schedule its first period to end before granting access.
// Every lifecycle delivery can finish this step; an outage remains retryable.
async function ensureOneMonthEnd(subscription, { secret, fetchImpl = globalThis.fetch } = {}) {
  if (subscription.metadata?.renewal_mode !== "one_month" ||
      ["canceled", "incomplete_expired"].includes(subscription.status) ||
      subscription.cancel_at_period_end) return subscription;
  if (!["active", "trialing", "past_due", "unpaid"].includes(subscription.status)) return subscription;
  const response = await fetchImpl(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscription.id)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": `hv-one-month-${subscription.id}`,
    },
    body: new URLSearchParams({ cancel_at_period_end: "true" }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("One-month membership end could not be scheduled");
  const updated = await response.json();
  if (updated.id !== subscription.id || updated.livemode !== subscription.livemode ||
      !updated.cancel_at_period_end) throw new Error("One-month membership end was not confirmed by Stripe");
  return updated;
}

module.exports = { ensureOneMonthEnd, serializeMembershipOperation };
