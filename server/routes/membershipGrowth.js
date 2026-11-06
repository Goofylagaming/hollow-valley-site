"use strict";

const router = require("express").Router();
const { db } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/requireAuth");
const { migrateGrowth } = require("../services/membershipGrowth");
router.use(requireAuth);
router.use((req,res,next) => {
  if (process.env.MEMBERSHIP_GROWTH_ENABLED !== "1") return res.sendStatus(404);
  if (req.method !== "GET") {
    try { if (new URL(req.get("origin")).host !== req.get("host")) return res.sendStatus(403); }
    catch { return res.sendStatus(403); }
  }
  migrateGrowth(db);
  next();
});

router.post("/admin/claim-tokens", requireAdmin, (req,res) => {
  const { grantKey, userId, reason, expiresAt = null } = req.body || {};
  if (typeof grantKey !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(grantKey) ||
      !Number.isSafeInteger(userId) || typeof reason !== "string" || !reason.trim() || reason.length > 200 ||
      (expiresAt !== null && !Number.isSafeInteger(expiresAt))) return res.sendStatus(400);
  if (!db.prepare("SELECT 1 FROM users WHERE id=?").get(userId)) return res.sendStatus(404);
  const result = db.prepare(`INSERT OR IGNORE INTO membership_bonus_claim_tokens
    (grant_key,user_id,granted_by,reason,granted_at,expires_at) VALUES (?,?,?,?,?,?)`)
    .run(grantKey,userId,req.user.id,reason,Date.now(),expiresAt);
  const row = db.prepare("SELECT * FROM membership_bonus_claim_tokens WHERE grant_key=?").get(grantKey);
  if (row.user_id !== userId || row.granted_by !== req.user.id || row.reason !== reason || row.expires_at !== expiresAt) return res.sendStatus(409);
  res.status(result.changes ? 201 : 200).json({ grantKey, duplicate:!result.changes });
});

router.post("/gift-intents", (req,res) => {
  const { recipient, requestKey } = req.body || {};
  if (!Number.isSafeInteger(recipient) || recipient === req.user.id || typeof requestKey !== "string" ||
      !/^[a-zA-Z0-9_-]{8,100}$/.test(requestKey)) return res.sendStatus(400);
  if (!db.prepare("SELECT 1 FROM users WHERE id=?").get(recipient)) return res.sendStatus(404);
  db.prepare("INSERT OR IGNORE INTO membership_gift_intents(request_key,sender,recipient) VALUES (?,?,?)").run(requestKey,req.user.id,recipient);
  const intent = db.prepare("SELECT sender,recipient FROM membership_gift_intents WHERE request_key=?").get(requestKey);
  if (intent.sender !== req.user.id || intent.recipient !== recipient) return res.sendStatus(409);
  res.json({checkoutEnabled:false});
});
const benefits = require("../services/membershipGrowthBenefits");
router.get("/pass", (req,res) => res.json({pass:benefits.activePass(req.user.id)}));
router.post("/admin/passes",requireAdmin,(req,res)=>{
  const {grantKey,userId,tier,startsAt,expiresAt}=req.body||{};
  if(typeof grantKey!=="string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(grantKey) || !Number.isSafeInteger(userId) ||
    !["supporter","guardian","legend"].includes(tier) || !Number.isSafeInteger(startsAt) || !Number.isSafeInteger(expiresAt) ||
    expiresAt<=startsAt || !db.prepare("SELECT 1 FROM users WHERE id=?").get(userId)) return res.sendStatus(400);
  db.prepare("INSERT OR IGNORE INTO membership_passes VALUES (?,?,?,?,?,?)").run(grantKey,userId,tier,startsAt,expiresAt,req.user.id);
  const pass=db.prepare("SELECT * FROM membership_passes WHERE grant_key=?").get(grantKey);
  if(pass.user_id!==userId || pass.tier!==tier || pass.starts_at!==startsAt || pass.expires_at!==expiresAt || pass.granted_by!==req.user.id) return res.sendStatus(409);
  res.json({source:"pass",expiresAt});
});
router.post("/referrals",(req,res)=>{
  if(process.env.MEMBERSHIP_REFERRALS_ENABLED!=="1") return res.sendStatus(404);
  res.sendStatus(benefits.recordReferral(req.user.id,req.body?.referrer)?200:409);
});
router.post("/admin/referrals/:recipient/qualify",requireAdmin,(req,res)=>{
  if(process.env.MEMBERSHIP_REFERRALS_ENABLED!=="1") return res.sendStatus(404);
  res.sendStatus(benefits.qualifyReferral(Number(req.params.recipient),req.user.id)?200:409);
});
router.post("/digest/preferences",(req,res)=>{
  if(typeof req.body?.enabled!=="boolean") return res.sendStatus(400);
  db.prepare("INSERT INTO membership_notification_preferences VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET monthly_digest=excluded.monthly_digest")
    .run(req.user.id,+req.body.enabled);
  res.json({enabled:req.body.enabled});
});
router.get("/digest",(req,res)=>res.json(benefits.digest(req.user)));
module.exports = router;
