const { configuration } = require("./supporterCheckout");
const { tierFromSubscription, upsertSupporter, subscriptionPeriodEnd } = require("./supporterWebhook");

class ReconcileError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isRecoverableSubscription(subscription) {
  return Boolean(
    subscription &&
    subscription.livemode === false &&
    subscription.id?.startsWith("sub_") &&
    !["canceled", "incomplete_expired"].includes(subscription.status)
  );
}

function scoreSubscription(subscription) {
  const statusScore = {
    active: 50,
    trialing: 45,
    past_due: 30,
    unpaid: 20,
    incomplete: 10,
  }[subscription.status] || 0;
  return statusScore * 1_000_000_000_000 + (Number(subscription.created) || 0);
}

async function stripeSearchSubscriptions({ query, env, fetchImpl }) {
  const config = configuration(env);
  if (!config) throw new ReconcileError(503, "Supporter sandbox recovery is not configured.");

  const qs = new URLSearchParams({ query, limit: "20" });
  try {
    const response = await fetchImpl(
      `https://api.stripe.com/v1/subscriptions/search?${qs.toString()}`,
      {
        headers: { Authorization: `Bearer ${config.secret}` },
        signal: AbortSignal.timeout(15000),
      }
    );
    if (!response.ok) throw new Error("Stripe subscription search failed");
    const payload = await response.json();
    return Array.isArray(payload.data) ? payload.data : [];
  } catch {
    throw new ReconcileError(502, "Unable to check Stripe Sandbox membership right now.");
  }
}

async function backfillSteamMetadata({ subscription, steamId, env, fetchImpl }) {
  if (!steamId || subscription?.metadata?.steam_id === String(steamId)) return;
  const config = configuration(env);
  if (!config) return;
  try {
    const body = new URLSearchParams({ "metadata[steam_id]": String(steamId) });
    await fetchImpl(
      `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscription.id)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.secret}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
        signal: AbortSignal.timeout(15000),
      }
    );
  } catch {
    // Recovery already succeeded locally; metadata backfill is best-effort only.
  }
}

async function reconcileCurrentUser({
  userId,
  steamId = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
}) {
  if (!userId) throw new ReconcileError(401, "Not logged in.");

  const candidates = [];
  const seen = new Set();

  if (steamId) {
    const bySteam = await stripeSearchSubscriptions({
      query: `metadata['steam_id']:'${String(steamId).replaceAll("'", "")}'`,
      env,
      fetchImpl,
    });
    for (const subscription of bySteam) {
      if (!seen.has(subscription.id)) {
        seen.add(subscription.id);
        candidates.push(subscription);
      }
    }
  }

  // Sandbox-only fallback for subscriptions created before Steam ID metadata
  // was added. This is intentionally not a live-billing recovery mechanism.
  const byUserId = await stripeSearchSubscriptions({
    query: `metadata['user_id']:'${String(userId)}'`,
    env,
    fetchImpl,
  });
  for (const subscription of byUserId) {
    if (!seen.has(subscription.id)) {
      seen.add(subscription.id);
      candidates.push(subscription);
    }
  }

  const eligible = candidates
    .filter(isRecoverableSubscription)
    .map((subscription) => ({
      subscription,
      tier: tierFromSubscription(subscription, env),
    }))
    .filter((entry) => entry.tier)
    .sort((a, b) => scoreSubscription(b.subscription) - scoreSubscription(a.subscription));

  const match = eligible[0];
  if (!match) return { recovered: false };

  const subscription = match.subscription;
  const autoRenew = !subscription.cancel_at_period_end && subscription.status !== "canceled";
  const status = upsertSupporter({
    userId,
    tier: match.tier,
    customerId: typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id || null,
    subscriptionId: subscription.id,
    status: subscription.status || "unknown",
    renewsAt: (() => {
      const unix = subscriptionPeriodEnd(subscription);
      return unix ? new Date(unix * 1000).toISOString() : null;
    })(),
    autoRenew,
  });

  if (status && steamId) {
    await backfillSteamMetadata({ subscription, steamId, env, fetchImpl });
  }

  return {
    recovered: Boolean(status),
    tier: match.tier,
    stripeStatus: subscription.status || "unknown",
  };
}

module.exports = {
  ReconcileError,
  reconcileCurrentUser,
  _test: { isRecoverableSubscription, scoreSubscription },
};
