const express = require("express");
const { db } = require("../db");
const { requireAdmin } = require("../middleware/requireAuth");
const { TIERS, normalizeTier } = require("../services/supporterTiers");
const { isEntitled } = require("../services/supporterWebhook");
const {
  DiscordMembershipError,
  configuration: discordMembershipConfiguration,
  syncDiscordMembershipForUser,
} = require("../services/discordMembership");

const router = express.Router();

function supporterRows() {
  const rows = db.prepare(`
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
    ORDER BY
      CASE WHEN s.stripe_status IN ('active', 'trialing') THEN 0 ELSE 1 END,
      s.started_at DESC,
      u.username COLLATE NOCASE ASC
  `).all();

  const discordConfigured = Boolean(discordMembershipConfiguration());
  return rows.map((row) => {
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
      steamLinked,
      discordLinked,
      needsDiscord: entitled && !discordLinked,
      roleSyncAvailable: entitled && discordLinked && discordConfigured,
    };
  });
}

router.get("/", requireAdmin, (_req, res) => {
  const supporters = supporterRows();
  res.json({
    supporters,
    discordRoleSyncConfigured: Boolean(discordMembershipConfiguration()),
    summary: {
      total: supporters.length,
      entitled: supporters.filter((entry) => entry.entitled).length,
      missingDiscord: supporters.filter((entry) => entry.needsDiscord).length,
      linkedDiscord: supporters.filter((entry) => entry.entitled && entry.discordLinked).length,
      cancelling: supporters.filter((entry) => entry.entitled && !entry.autoRenew).length,
    },
  });
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
module.exports._test = { supporterRows };
