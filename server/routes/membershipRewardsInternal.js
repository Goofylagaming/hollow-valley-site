"use strict";

const express = require("express");
const { db } = require("../db");
const { entitlement } = require("../services/membershipEntitlements");
const { configuredToken, bearerToken, secureEqual } = require("./supporterInternal")._test;

const router = express.Router();
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store, private");
  const expected = configuredToken();
  if (!expected) return res.status(503).json({ error: "Membership integration is not configured." });
  if (!secureEqual(bearerToken(req.get("authorization")), expected)) return res.status(401).json({ error: "Unauthorized." });
  next();
});

router.post("/entitlements", (req, res) => {
  const ids = req.body?.steamIds;
  if (!Array.isArray(ids) || ids.length > 200 || ids.some(value => typeof value !== "string" || !/^\d{17}$/.test(value))) {
    return res.status(400).json({ error: "Provide at most 200 valid Steam IDs." });
  }
  const query = db.prepare(`SELECT s.* FROM users u LEFT JOIN supporter_subscriptions s ON s.user_id = u.id WHERE u.steam_id = ?`);
  const memberships = [...new Set(ids)].map(steamId => ({ steamId, ...entitlement(query.get(steamId)) }));
  return res.json({ memberships });
});

module.exports = router;
