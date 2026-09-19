const crypto = require("node:crypto");
const express = require("express");
const { db } = require("../db");
const { TIERS } = require("../services/supporterCheckout");
const { normalizeTier } = require("../services/supporterTiers");
const { isEntitled } = require("../services/supporterWebhook");

const router = express.Router();

function configuredToken(env = process.env) {
  return String(env.HOLLOW_VALLEY_API_TOKEN || "").trim();
}

function bearerToken(header) {
  const match = /^Bearer\s+(.+)$/i.exec(String(header || "").trim());
  return match ? match[1].trim() : "";
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

router.use((req, res, next) => {
  const expected = configuredToken();
  if (!expected) {
    return res.status(503).json({ error: "Supporter membership integration is disabled." });
  }
  if (!secureEqual(bearerToken(req.get("authorization")), expected)) {
    return res.status(401).json({ error: "Unauthorized." });
  }
  next();
});

router.post("/", (req, res) => {
  const rawIds = req.body?.steamIds;
  if (!Array.isArray(rawIds) || rawIds.length > 200) {
    return res.status(400).json({ error: "steamIds must be an array with at most 200 entries." });
  }

  const steamIds = [...new Set(rawIds.map((value) => String(value || "").trim()))];
  if (steamIds.some((steamId) => !/^\d{17}$/.test(steamId))) {
    return res.status(400).json({ error: "Every Steam ID must be a valid 17-digit SteamID64." });
  }

  const lookup = db.prepare(`
    SELECT u.steam_id, s.tier, s.stripe_status
    FROM users u
    LEFT JOIN supporter_subscriptions s ON s.user_id = u.id
    WHERE u.steam_id = ?
  `);

  const memberships = steamIds.map((steamId) => {
    const row = lookup.get(steamId);
    const tier = normalizeTier(row?.tier);
    const entitled = Boolean(
      row &&
      tier &&
      Object.hasOwn(TIERS, tier) &&
      isEntitled(row.stripe_status)
    );
    return {
      steamId,
      entitled,
      tier: entitled ? tier : null,
    };
  });

  return res.json({ memberships });
});

module.exports = router;
module.exports._test = { configuredToken, bearerToken, secureEqual };
