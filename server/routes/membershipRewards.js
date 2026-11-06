"use strict";

const express = require("express");
const { requireAuth, requireAdmin } = require("../middleware/requireAuth");
const { skinMutationGuard } = require("../middleware/skinStudioSafety");
const rewards = require("../services/membershipRewards");
const { syncPaidHistory } = require("../services/membershipHistory");
const skinVote = require("../services/membershipSkinVote");

const router = express.Router();
router.use((req, _res, next) => {
  if (req.path === "/appearance" || req.path === "/rewards" || req.path.startsWith("/rewards/") || req.path.startsWith("/skin-vote")) return next();
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
  result.skinVote = skinVote.currentForUser(user);
  if (!/^\d{17}$/.test(String(user.steam_id || ""))) return result;
  const client = require("../services/premiumSkinClient");
  try {
    const catalogue = await client.listCatalog(String(user.steam_id));
    result.monthly.catalogueReady = Boolean(catalogue?.enabled && catalogue.skins?.length);
  } catch { result.monthly.catalogueUnavailable = true; }
  return result;
}

async function daily(req, res) {
  if (process.env.DAILY_LOGIN_REWARDS_ENABLED !== "1") return res.sendStatus(404);
  try {
    const status = require("../db").getSupporterStatus(req.user.id);
    const tier = rewards.entitlement(status).tier;
    const result = await require("../services/automationWebsiteClient").dailyLogin(
      req.method === "POST" ? "claim" : "status", { steamId:req.user.steam_id, tier, day:req.body?.day });
    return res.json(result);
  } catch (error) { return sendError(res,error); }
}
router.get("/rewards/daily/admin/:userId",requireAdmin,async(req,res)=>{
  if(process.env.DAILY_LOGIN_REWARDS_ENABLED!=="1") return res.sendStatus(404);
  const id=Number(req.params.userId);
  const store=require("../db");
  const player=store.db.prepare("SELECT steam_id FROM users WHERE id=?").get(id);
  if(!player?.steam_id) return res.sendStatus(404);
  try {
    const tier=rewards.entitlement(store.getSupporterStatus(id)).tier;
    return res.json(await require("../services/automationWebsiteClient").dailyLogin("diagnostics",{steamId:player.steam_id,tier}));
  }catch(error){return sendError(res,error);}
});
router.get("/rewards/daily", daily);
router.post("/rewards/daily", daily);

router.post("/rewards/collection/preferences", (req,res)=>{
  if(process.env.MEMBERSHIP_COLLECTION_ENABLED!=="1") return res.sendStatus(404);
  try {return res.json(require("../services/membershipVault").savePreferences(req.user.id,req.body||{}));}
  catch(error){return sendError(res,error);}
});

router.get("/rewards/collection", (req, res) => {
  if (process.env.MEMBERSHIP_COLLECTION_ENABLED !== "1") return res.sendStatus(404);
  try { return res.json(require("../services/membershipVault").readVault(req.user.id)); }
  catch (error) { return sendError(res, error); }
});

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

router.get("/skin-vote", (req, res) => {
  try { return res.json(skinVote.currentForUser(req.user)); }
  catch (error) { return sendError(res, error); }
});

router.post("/skin-vote/vote", (req, res) => {
  try { return res.json(skinVote.castVote(req.user, req.body?.optionId)); }
  catch (error) {
    if (error instanceof skinVote.SkinVoteError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    return sendError(res, error);
  }
});

module.exports = router;
module.exports._test = { summary };
