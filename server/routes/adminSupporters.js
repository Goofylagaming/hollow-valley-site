const express = require("express");
const { db } = require("../db");
const { requireAdmin } = require("../middleware/requireAuth");
const { TIERS, normalizeTier } = require("../services/supporterTiers");
const { configuration: stripeConfiguration } = require("../services/supporterCheckout");
const {
  isEntitled,
  tierFromSubscription,
  upsertSupporter,
  subscriptionPeriodEnd,
} = require("../services/supporterWebhook");
const {
  DiscordMembershipError,
  configuration: discordMembershipConfiguration,
  syncDiscordMembershipForUser,
} = require("../services/discordMembership");

const router = express.Router();

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

function localSubscriptions() {
  return db.prepare(`
    SELECT
      s.user_id,
      u.username,
      u.steam_id,
      u.discord_id,
      u.avatar,
      s.tier,
      s.auto_renew,
      s.started_at,
      s.renews_at,
      s.cancelled_at,
      s.stripe_customer_id,
      s.stripe_subscription_id,
      s.stripe_status
    FROM supporter_subscriptions s
    JOIN users u ON u.id = s.user_id
    ORDER BY s.started_at DESC
  `).all();
}

function users() {
  return db.prepare("SELECT id, username, steam_id, discord_id, avatar FROM users").all();
}

async function listStripeSubscriptions({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const config = stripeConfiguration(env);
  if (!config) return { configured: false, subscriptions: [] };

  const subscriptions = [];
  let startingAfter = null;

  for (let page = 0; page < 3; page += 1) {
    const params = new URLSearchParams({
      status: "all",
      limit: "100",
    });
    params.append("expand[]", "data.customer");
    if (startingAfter) params.set("starting_after", startingAfter);

    const response = await fetchImpl(`https://api.stripe.com/v1/subscriptions?${params.toString()}`, {
      headers: { Authorization: `Bearer ${config.secret}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Stripe subscription lookup failed (HTTP ${response.status})`);

    const payload = await response.json();
    const pageItems = Array.isArray(payload.data) ? payload.data : [];
    for (const subscription of pageItems) {
      const tier = tierFromSubscription(subscription, env) || normalizeTier(subscription?.metadata?.tier);
      if (!tier || !Object.hasOwn(TIERS, tier)) continue;
      subscriptions.push({ subscription, tier });
    }

    if (!payload.has_more || !pageItems.length) break;
    startingAfter = pageItems[pageItems.length - 1]?.id || null;
    if (!startingAfter) break;
  }

  return { configured: true, subscriptions };
}

function localRowToEntry(row, { discordConfigured }) {
  const tier = normalizeTier(row.tier);
  const entitled = isEntitled(row.stripe_status);
  const discordLinked = Boolean(String(row.discord_id || "").trim());
  const steamLinked = Boolean(String(row.steam_id || "").trim());

  return {
    userId: Number(row.user_id),
    username: row.username || "Unknown player",
    steamId: row.steam_id || null,
    discordId: row.discord_id || null,
    avatar: row.avatar || null,
    tier: tier || row.tier,
    tierLabel: tier && TIERS[tier] ? TIERS[tier].label : (row.tier || "Unknown"),
    stripeStatus: row.stripe_status || "unknown",
    entitled,
    autoRenew: Boolean(row.auto_renew),
    startedAt: row.started_at || null,
    renewsAt: row.renews_at || null,
    cancelledAt: row.cancelled_at || null,
    stripeCustomerId: row.stripe_customer_id || null,
    stripeSubscriptionId: row.stripe_subscription_id || null,
    stripeCustomerEmail: null,
    stripeCustomerName: null,
    steamLinked,
    discordLinked,
    websiteMatched: true,
    localSubscriptionRecorded: true,
    needsReconcile: false,
    needsWebsiteLink: false,
    needsDiscord: entitled && !discordLinked,
    roleSyncAvailable: entitled && discordLinked && discordConfigured,
    source: "website-record",
  };
}

function mergeSupporterData({ stripeResult, localRows, userRows, discordConfigured }) {
  const localBySubscription = new Map(
    localRows
      .filter((row) => row.stripe_subscription_id)
      .map((row) => [String(row.stripe_subscription_id), row])
  );
  const usersById = new Map(userRows.map((user) => [Number(user.id), user]));
  const usersBySteam = new Map(
    userRows
      .filter((user) => user.steam_id)
      .map((user) => [String(user.steam_id), user])
  );
  const seenLocalSubscriptions = new Set();
  const entries = [];

  for (const { subscription, tier } of stripeResult.subscriptions || []) {
    const subscriptionId = normalizeId(subscription?.id);
    const local = subscriptionId ? localBySubscription.get(subscriptionId) || null : null;
    if (local?.stripe_subscription_id) seenLocalSubscriptions.add(String(local.stripe_subscription_id));

    const metadataUserId = /^\d+$/.test(String(subscription?.metadata?.user_id || ""))
      ? Number(subscription.metadata.user_id)
      : null;
    const metadataSteamId = /^\d{17}$/.test(String(subscription?.metadata?.steam_id || ""))
      ? String(subscription.metadata.steam_id)
      : null;

    const matchedUser =
      (local ? usersById.get(Number(local.user_id)) : null) ||
      (metadataUserId ? usersById.get(metadataUserId) : null) ||
      (metadataSteamId ? usersBySteam.get(metadataSteamId) : null) ||
      null;

    const customer = typeof subscription?.customer === "object" ? subscription.customer : null;
    const stripeStatus = String(subscription?.status || "unknown");
    const entitled = isEntitled(stripeStatus);
    const discordLinked = Boolean(String(matchedUser?.discord_id || "").trim());
    const steamId = metadataSteamId || matchedUser?.steam_id || local?.steam_id || null;
    const websiteMatched = Boolean(matchedUser);
    const localSubscriptionRecorded = Boolean(local);

    entries.push({
      userId: matchedUser ? Number(matchedUser.id) : null,
      username: matchedUser?.username || customer?.name || customer?.email || "Stripe customer",
      steamId,
      discordId: matchedUser?.discord_id || null,
      avatar: matchedUser?.avatar || null,
      tier,
      tierLabel: TIERS[tier]?.label || tier,
      stripeStatus,
      entitled,
      autoRenew: !subscription?.cancel_at_period_end && stripeStatus !== "canceled",
      startedAt: isoFromUnix(subscription?.created),
      renewsAt: isoFromUnix(subscriptionPeriodEnd(subscription)),
      cancelledAt: subscription?.canceled_at ? isoFromUnix(subscription.canceled_at) : null,
      stripeCustomerId: normalizeId(subscription?.customer),
      stripeSubscriptionId: subscriptionId,
      stripeCustomerEmail: customer?.email || null,
      stripeCustomerName: customer?.name || null,
      steamLinked: Boolean(steamId),
      discordLinked,
      websiteMatched,
      localSubscriptionRecorded,
      needsReconcile: entitled && websiteMatched && !localSubscriptionRecorded,
      needsWebsiteLink: entitled && !websiteMatched,
      needsDiscord: entitled && websiteMatched && !discordLinked,
      roleSyncAvailable: entitled && discordLinked && localSubscriptionRecorded && discordConfigured,
      source: "stripe-live",
    });
  }

  for (const row of localRows) {
    if (row.stripe_subscription_id && seenLocalSubscriptions.has(String(row.stripe_subscription_id))) continue;
    entries.push(localRowToEntry(row, { discordConfigured }));
  }

  return entries.sort((a, b) => {
    const attentionA = Number(a.needsWebsiteLink || a.needsReconcile || a.needsDiscord);
    const attentionB = Number(b.needsWebsiteLink || b.needsReconcile || b.needsDiscord);
    if (attentionA !== attentionB) return attentionB - attentionA;
    if (a.entitled !== b.entitled) return Number(b.entitled) - Number(a.entitled);
    return String(b.startedAt || "").localeCompare(String(a.startedAt || ""));
  });
}

router.get("/", requireAdmin, async (_req, res) => {
  const localRows = localSubscriptions();
  const userRows = users();
  const discordConfigured = Boolean(discordMembershipConfiguration());

  let stripeResult = { configured: Boolean(stripeConfiguration()), subscriptions: [] };
  let stripeError = null;
  try {
    stripeResult = await listStripeSubscriptions();
  } catch (error) {
    stripeError = error.message || "Stripe lookup failed.";
  }

  const supporters = mergeSupporterData({
    stripeResult,
    localRows,
    userRows,
    discordConfigured,
  });

  res.json({
    supporters,
    stripeConfigured: stripeResult.configured,
    stripeLive: stripeResult.configured && !stripeError,
    stripeError,
    discordRoleSyncConfigured: discordConfigured,
    summary: {
      total: supporters.length,
      entitled: supporters.filter((entry) => entry.entitled).length,
      missingDiscord: supporters.filter((entry) => entry.needsDiscord).length,
      needsReconcile: supporters.filter((entry) => entry.needsReconcile || entry.needsWebsiteLink).length,
      linkedDiscord: supporters.filter((entry) => entry.entitled && entry.discordLinked).length,
      cancelling: supporters.filter((entry) => entry.entitled && !entry.autoRenew).length,
    },
  });
});

router.post("/:userId/repair-stripe", requireAdmin, async (req, res) => {
  const userId = Number(req.params.userId);
  const subscriptionId = String(req.body?.subscriptionId || "").trim();
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: "Invalid supporter user ID." });
  }
  if (!/^sub_[A-Za-z0-9_]+$/.test(subscriptionId)) {
    return res.status(400).json({ error: "A valid Stripe subscription ID is required." });
  }

  const config = stripeConfiguration();
  if (!config) return res.status(503).json({ error: "Stripe supporter integration is not configured." });

  const user = db.prepare("SELECT id, steam_id, discord_id FROM users WHERE id = ?").get(userId);
  if (!user) return res.status(404).json({ error: "Website user was not found." });

  try {
    const params = new URLSearchParams();
    params.append("expand[]", "customer");
    const response = await fetch(
      `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}?${params.toString()}`,
      {
        headers: { Authorization: `Bearer ${config.secret}` },
        signal: AbortSignal.timeout(15000),
      }
    );
    if (!response.ok) return res.status(502).json({ error: "Stripe subscription could not be loaded." });

    const subscription = await response.json();
    if (subscription.livemode !== config.live) {
      return res.status(409).json({ error: "Stripe subscription mode does not match the website configuration." });
    }

    const tier = tierFromSubscription(subscription) || normalizeTier(subscription?.metadata?.tier);
    if (!tier || !Object.hasOwn(TIERS, tier)) {
      return res.status(409).json({ error: "This Stripe subscription is not a recognized Hollow Valley supporter tier." });
    }

    const metadataUserId = /^\d+$/.test(String(subscription?.metadata?.user_id || ""))
      ? Number(subscription.metadata.user_id)
      : null;
    const metadataSteamId = /^\d{17}$/.test(String(subscription?.metadata?.steam_id || ""))
      ? String(subscription.metadata.steam_id)
      : null;
    const existing = db.prepare(
      "SELECT user_id FROM supporter_subscriptions WHERE stripe_subscription_id = ?"
    ).get(subscriptionId);

    const identityMatches =
      metadataUserId === userId ||
      (metadataSteamId && metadataSteamId === String(user.steam_id || "")) ||
      Number(existing?.user_id || 0) === userId;

    if (!identityMatches) {
      return res.status(409).json({
        error: "Stripe subscription identity does not match this Hollow Valley website account.",
      });
    }

    const status = upsertSupporter({
      userId,
      tier,
      customerId: normalizeId(subscription.customer),
      subscriptionId,
      status: subscription.status || "unknown",
      renewsAt: isoFromUnix(subscriptionPeriodEnd(subscription)),
      autoRenew: !subscription.cancel_at_period_end && subscription.status !== "canceled",
    });

    let discordSync = null;
    let discordSyncError = null;
    if (status && isEntitled(status.stripe_status) && user.discord_id) {
      try {
        discordSync = await syncDiscordMembershipForUser(userId);
      } catch (error) {
        discordSyncError = error.message || "Discord role sync failed after repairing the membership.";
      }
    }

    return res.json({
      ok: true,
      repaired: Boolean(status),
      tier,
      stripeStatus: subscription.status || "unknown",
      discordSync,
      discordSyncError,
    });
  } catch (error) {
    return res.status(502).json({ error: error.message || "Unable to repair supporter membership from Stripe." });
  }
});

router.post("/:userId/sync-discord", requireAdmin, async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: "Invalid supporter user ID." });
  }

  const supporter = db.prepare(`
    SELECT s.user_id, s.stripe_status, u.discord_id
    FROM supporter_subscriptions s
    JOIN users u ON u.id = s.user_id
    WHERE s.user_id = ?
  `).get(userId);

  if (!supporter) return res.status(404).json({ error: "Supporter subscription was not found." });
  if (!isEntitled(supporter.stripe_status)) {
    return res.status(409).json({ error: "This supporter is not currently entitled to a supporter role." });
  }
  if (!supporter.discord_id) {
    return res.status(409).json({
      error: "This supporter has paid, but their Discord account is not linked to the website yet.",
      code: "DISCORD_NOT_LINKED",
    });
  }

  try {
    const result = await syncDiscordMembershipForUser(userId);
    if (!result.configured) {
      return res.status(503).json({ error: "Discord supporter role sync is not configured." });
    }
    return res.json({ ok: true, ...result });
  } catch (error) {
    return res.status(error instanceof DiscordMembershipError ? error.status : 500).json({
      error: error instanceof DiscordMembershipError
        ? error.message
        : "Unable to sync this supporter's Discord role.",
    });
  }
});

module.exports = router;
module.exports._test = {
  localSubscriptions,
  listStripeSubscriptions,
  mergeSupporterData,
};
