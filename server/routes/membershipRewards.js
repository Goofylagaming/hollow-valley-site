"use strict";

const express = require("express");
const { requireAuth } = require("../middleware/requireAuth");
const { skinMutationGuard } = require("../middleware/skinStudioSafety");
const rewards = require("../services/membershipRewards");
const { syncPaidHistory } = require("../services/membershipHistory");

const router = express.Router();
router.use((req, _res, next) => {
  if (req.path === "/appearance" || req.path === "/rewards" || req.path.startsWith("/rewards/")) return next();
  return next("router");
});
router.use(requireAuth);
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store, private");
  if (req.method !== "GET" && req.get("origin")) {
    try {
      if (new URL(req.get("origin")).host !== req.get("host")) {
        return res.status(403).json({ error: "Use the Hollow Valley website to update membership rewards.", code: "ORIGIN_MISMATCH" });
      }
    } catch { return res.status(403).json({ error: "Invalid request origin.", code: "ORIGIN_MISMATCH" }); }
  }
  next();
});

function sendError(res, error) {
  const known = error instanceof rewards.MembershipError;
  return res.status(known ? error.status : 503).json({
    error: known ? error.message : "Membership rewards are temporarily unavailable. Please try again.",
    code: known ? error.code : "REWARDS_UNAVAILABLE",
  });
}

async function summary(user) {
  const result = rewards.rewardSummary(user);
  if (!result.enabled) return result;
  result.discord = { ...result.discord, ...require("../services/membershipDiscordQueue").getSyncState(user.id) };
  if (!/^\d{17}$/.test(String(user.steam_id || ""))) return result;
  const client = require("../services/premiumSkinClient");
  const automation = require("../services/automationWebsiteClient");
  const remote = await Promise.allSettled([
    client.listCatalog(String(user.steam_id)),
    automation.getMembershipStorage(String(user.steam_id)),
  ]);
  if (remote[0].status === "fulfilled") {
    result.monthly.catalogueReady = Boolean(remote[0].value?.enabled && remote[0].value?.skins?.length);
  } else result.monthly.catalogueUnavailable = true;
  if (remote[1].status === "fulfilled") {
    const storage = remote[1].value || {};
    result.storage = { ...result.storage, ...storage,
      totalSlots: storage.totalSlots ?? storage.limit ?? null,
      usedSlots: storage.usedSlots ?? storage.used ?? null };
  } else result.storage.unavailable = true;
  return result;
}

router.get("/rewards", async (req, res) => {
  try { return res.json(await summary(req.user)); } catch (error) { return sendError(res, error); }
});

router.post("/appearance", (req, res) => {
  try { return res.json(rewards.updateAppearance(req.user, req.body)); } catch (error) { return sendError(res, error); }
});

router.post("/rewards/sync-history", async (req, res) => {
  try {
    const historySync = await syncPaidHistory(req.user.id);
    return res.json({ ...(await summary(req.user)), historySync });
  } catch (error) { return sendError(res, error); }
});

router.post("/rewards/skins/:skinId/claim", skinMutationGuard, async (req, res) => {
  try { return res.json(await rewards.claimSkin(req.user, req.params.skinId)); }
  catch (error) { return sendError(res, error); }
});

module.exports = router;
module.exports._test = { summary };
