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
  if(process.env.MEMBERSHIP_GROWTH_ENABLED==="1"){
    const {db}=require("../db");
    require("../services/membershipGrowth").migrateGrowth(db);
    result.monthly.bonusTokens=db.prepare("SELECT count(*) AS n FROM membership_bonus_claim_tokens WHERE user_id=? AND redeemed_at IS NULL AND (expires_at IS NULL OR expires_at>?)").get(user.id,Date.now()).n;
  }
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

async function verifiedAchievements(user) {
  if(!/^\d{17}$/.test(user.steam_id||"")) return [];
  const result=await require("../services/automationWebsiteClient").getTitleEvidence([user.steam_id]);
  return result.players?.find(p=>p.steamId===user.steam_id)?.achievementIds || [];
}

router.post("/rewards/collection/preferences", async(req,res)=>{
  if(process.env.MEMBERSHIP_COLLECTION_ENABLED!=="1") return res.sendStatus(404);
  try {return res.json(require("../services/membershipVault").savePreferences(req.user.id,req.body||{},req.body?.featured_achievement ? await verifiedAchievements(req.user) : []));}
  catch(error){return sendError(res,error);}
});

router.get("/rewards/collection", async(req, res) => {
  if (process.env.MEMBERSHIP_COLLECTION_ENABLED !== "1") return res.sendStatus(404);
  try {
    const book=require("../services/membershipVault").readVault(req.user.id);
    try {book.achievementIds=await verifiedAchievements(req.user);}catch{book.achievementIds=null;}
    return res.json(book);
  }
  catch (error) { return sendError(res, error); }
});

router.post("/rewards/admin/milestones",requireAdmin,(req,res)=>{
  if(process.env.MEMBERSHIP_COLLECTION_ENABLED!=="1")return res.sendStatus(404);
  const {months,slug,name,kind,colour}=req.body||{};
  if(![18,24].includes(months)||typeof slug!=="string"||!/^[a-z][a-z0-9-]{1,63}$/.test(slug)||
    typeof name!=="string"||!name.trim()||name.length>80||!["badge","title","accent","banner"].includes(kind)||
    (["accent","banner"].includes(kind)&&!/^#[a-f0-9]{6}$/i.test(colour||"")))return res.sendStatus(400);
  const {db}=require("../db");
  require("../services/membershipCollection").migrate(db,new Date(Date.now()+36000000).toISOString().slice(0,7));
  db.exec("BEGIN IMMEDIATE");
  try{
    const existing=db.prepare("SELECT kind,name FROM membership_collectibles WHERE slug=?").get(slug);
    if(existing && (existing.kind!==kind||existing.name!==name)){db.exec("ROLLBACK");return res.sendStatus(409);}
    db.prepare("INSERT OR IGNORE INTO membership_collectibles(slug,name,kind,listed) VALUES (?,?,?,1)").run(slug,name,kind);
    if(["accent","banner"].includes(kind))db.prepare("INSERT INTO membership_cosmetic_styles VALUES (?,?) ON CONFLICT(slug) DO UPDATE SET colour=excluded.colour").run(slug,colour);
    db.prepare("UPDATE membership_extended_milestones SET collectible_slug=? WHERE months=?").run(slug,months);
    db.exec("COMMIT");res.json({months,slug});
  }catch(e){db.exec("ROLLBACK");throw e;}
});

router.get("/rewards/admin/seasons",requireAdmin,(req,res)=>{
  if(process.env.MEMBERSHIP_COLLECTION_ENABLED!=="1")return res.sendStatus(404);
  const {db}=require("../db");
  require("../services/membershipCollection").migrate(db,new Date(Date.now()+36000000).toISOString().slice(0,7));
  res.json(db.prepare("SELECT * FROM membership_seasons ORDER BY brisbane_month DESC,slug").all());
});
router.post("/rewards/admin/seasons",requireAdmin,(req,res)=>{
  if(process.env.MEMBERSHIP_COLLECTION_ENABLED!=="1")return res.sendStatus(404);
  const {slug,name,month,state,cosmetics="",voteRef="",eventRef="",notes=""}=req.body||{};
  if(!/^[a-z][a-z0-9-]{1,63}$/.test(slug||"") || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month||"") ||
    !["draft","preview","live","archived"].includes(state) || typeof name!=="string" || !name.trim() || name.length>80 ||
    [cosmetics,voteRef,eventRef,notes].some(s=>typeof s!=="string"||s.length>500))return res.sendStatus(400);
  const {db}=require("../db");
  require("../services/membershipCollection").migrate(db,new Date(Date.now()+36000000).toISOString().slice(0,7));
  db.prepare(`INSERT INTO membership_seasons(slug,name,brisbane_month,state,cosmetic_description,vote_ref,public_event_ref,admin_notes)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(slug) DO UPDATE SET name=excluded.name,brisbane_month=excluded.brisbane_month,state=excluded.state,
    cosmetic_description=excluded.cosmetic_description,vote_ref=excluded.vote_ref,public_event_ref=excluded.public_event_ref,admin_notes=excluded.admin_notes`)
    .run(slug,name,month,state,cosmetics,voteRef,eventRef,notes);
  res.json({slug,state});
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
