const { TIERS, configuration, stableIdentityRequired } = require("./supporterCheckout");
const { normalizeTier, stripePriceId } = require("./supporterTiers");

class ManageError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const BLOCKED_STATUSES = new Set(["canceled", "incomplete_expired"]);

function validateSubscriptionId(subscriptionId) {
  return typeof subscriptionId === "string" && /^sub_[A-Za-z0-9_]+$/.test(subscriptionId);
}

async function stripeRequest(path, {
  method = "GET",
  body = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const config = configuration(env);
  if (!config) throw new ManageError(503, "Supporter management is not configured yet.");

  try {
    const response = await fetchImpl(`https://api.stripe.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.secret}`,
        ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      ...(body ? { body } : {}),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const code = payload?.error?.code || "stripe_rejected_management";
      const type = payload?.error?.type || "unknown";
      const message = payload?.error?.message || "Stripe rejected membership management request";
      console.error(
        `[supporter-manage] method=${method} path=${path} status=${response.status} type=${type} code=${code} message=${message}`
      );
      throw new Error("Stripe rejected membership management request");
    }

    const payload = await response.json();
    if (payload?.livemode !== config.live) {
      console.error(`[supporter-manage] Stripe mode mismatch path=${path} expectedLive=${config.live} actualLive=${payload?.livemode}`);
      throw new Error("Stripe mode mismatch");
    }
    return payload;
  } catch (error) {
    if (error instanceof ManageError) throw error;
    if (error?.name === "TimeoutError") {
      console.error(`[supporter-manage] Stripe request timed out method=${method} path=${path}`);
    } else if (
      error?.message !== "Stripe rejected membership management request" &&
      error?.message !== "Stripe mode mismatch"
    ) {
      console.error(`[supporter-manage] Stripe request failed method=${method} path=${path}: ${error?.message || "unknown error"}`);
    }
    throw new ManageError(502, "Unable to update Stripe membership. Please try again.");
  }
}

function ensureOwnedSubscription(subscription, userId, steamId = null, env = process.env) {
  const metadataUser = String(subscription?.metadata?.user_id || "");
  const metadataSteam = String(subscription?.metadata?.steam_id || "");
  const normalizedSteam = String(steamId || "");

  if (stableIdentityRequired(env)) {
    if (!/^\d{15,22}$/.test(normalizedSteam) || metadataSteam !== normalizedSteam) {
      throw new ManageError(403, "This Stripe subscription is not linked to your Steam account.");
    }
  } else if (metadataSteam && normalizedSteam) {
    if (metadataSteam !== normalizedSteam) {
      throw new ManageError(403, "This Stripe subscription is not linked to your Steam account.");
    }
  } else if (!metadataUser || metadataUser !== String(userId)) {
    throw new ManageError(403, "This Stripe subscription is not linked to your Hollow Valley account.");
  }

  if (BLOCKED_STATUSES.has(subscription.status)) {
    throw new ManageError(409, "This subscription can no longer be changed.");
  }
}

function currentPriceId(subscription) {
  return subscription?.items?.data?.[0]?.price?.id || null;
}

function currentItemId(subscription) {
  return subscription?.items?.data?.[0]?.id || null;
}

async function getSubscription({
  subscriptionId,
  userId,
  steamId = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
}) {
  if (!validateSubscriptionId(subscriptionId)) {
    throw new ManageError(400, "Invalid Stripe subscription.");
  }
  const subscription = await stripeRequest(
    `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
    { env, fetchImpl }
  );
  ensureOwnedSubscription(subscription, userId, steamId, env);
  return subscription;
}

async function changeSubscription({
  subscriptionId,
  tier,
  userId,
  steamId = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
}) {
  const canonicalTier = normalizeTier(tier);
  if (!canonicalTier || !Object.hasOwn(TIERS, canonicalTier)) throw new ManageError(404, "Unknown membership tier.");
  const subscription = await getSubscription({ subscriptionId, userId, steamId, env, fetchImpl });

  const itemId = currentItemId(subscription);
  if (!itemId) throw new ManageError(409, "Stripe subscription has no changeable subscription item.");

  const targetPrice = stripePriceId(canonicalTier, env);
  if (currentPriceId(subscription) === targetPrice && !subscription.cancel_at_period_end) {
    return { ok: true, changed: false, tier: canonicalTier, cancelAtPeriodEnd: false };
  }

  const body = new URLSearchParams({
    "items[0][id]": itemId,
    "items[0][price]": targetPrice,
    "metadata[tier]": canonicalTier,
    cancel_at_period_end: "false",
    proration_behavior: "create_prorations",
  });

  const updated = await stripeRequest(
    `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
    { method: "POST", body, env, fetchImpl }
  );
  ensureOwnedSubscription(updated, userId, steamId, env);

  return {
    ok: true,
    changed: true,
    tier: canonicalTier,
    status: updated.status,
    cancelAtPeriodEnd: Boolean(updated.cancel_at_period_end),
  };
}

async function cancelSubscription({
  subscriptionId,
  userId,
  steamId = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
}) {
  const subscription = await getSubscription({ subscriptionId, userId, steamId, env, fetchImpl });
  if (subscription.cancel_at_period_end) {
    return { ok: true, changed: false, cancelAtPeriodEnd: true };
  }

  const body = new URLSearchParams({ cancel_at_period_end: "true" });
  const updated = await stripeRequest(
    `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
    { method: "POST", body, env, fetchImpl }
  );
  ensureOwnedSubscription(updated, userId, steamId, env);

  return {
    ok: true,
    changed: true,
    status: updated.status,
    cancelAtPeriodEnd: Boolean(updated.cancel_at_period_end),
  };
}

async function resumeSubscription({
  subscriptionId,
  userId,
  steamId = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
}) {
  const subscription = await getSubscription({ subscriptionId, userId, steamId, env, fetchImpl });
  if (!subscription.cancel_at_period_end) {
    return { ok: true, changed: false, cancelAtPeriodEnd: false };
  }

  const body = new URLSearchParams({ cancel_at_period_end: "false" });
  const updated = await stripeRequest(
    `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
    { method: "POST", body, env, fetchImpl }
  );
  ensureOwnedSubscription(updated, userId, steamId, env);

  return {
    ok: true,
    changed: true,
    status: updated.status,
    cancelAtPeriodEnd: Boolean(updated.cancel_at_period_end),
  };
}

module.exports = {
  ManageError,
  getSubscription,
  changeSubscription,
  cancelSubscription,
  resumeSubscription,
  _test: {
    validateSubscriptionId,
    currentPriceId,
    currentItemId,
    ensureOwnedSubscription,
  },
};
