"use strict";
const express = require("express");
const { requireAdmin } = require("../middleware/requireAuth");
const guides = require("../services/communityGuides");

const router = express.Router();

function sameOriginJson(req,res,next) {
  const origin = req.get("Origin");
  let expected;
  try {
    expected = process.env.PUBLIC_SITE_URL
      ? new URL(process.env.PUBLIC_SITE_URL).origin
      : req.protocol + "://" + req.get("Host");
  } catch { return res.status(500).json({ error:"The website's public origin is not configured." }); }
  if (!origin || origin !== expected) return res.status(403).json({ error:"Save policies through this Hollow Valley website only." });
  if (!req.is("application/json")) return res.status(415).json({ error:"Use JSON when editing server policies." });
  next();
}
function respondError(res,error) {
  const status = error.code === "EDIT_CONFLICT" || error.code === "UNCHANGED_POLICY" ? 409 :
    error.code === "STEAM_REQUIRED" ? 403 :
    ["INVALID_POLICY","INVALID_GROUP","CONFIRM_REQUIRED","EMPTY_POLICY"].includes(error.code) ? 400 : 500;
  if(status === 500)console.error("[community-guides] error",error);
  return res.status(status).json({ error: status===500 ? "Community guides are unavailable." : error.message,
    code: status===500 ? "GUIDES_UNAVAILABLE" : error.code });
}
router.use((_req,res,next)=>{res.set("Cache-Control","no-store");next();});
router.get("/", (_req,res)=> {
  try {return res.json(guides.publicState());}
  catch(error) {return respondError(res,error);}
});
router.get("/history", (_req,res)=> {
  try {return res.json({history:guides.publicHistory()});}
  catch(error) {return respondError(res,error);}
});
router.post("/check", sameOriginJson, (req,res)=>{
  try {
    const source = guides.publicState();
    const result = guides.assessGroup(source, {
      speciesA:req.body?.speciesA, speciesB:req.body?.speciesB || req.body?.speciesA,
      count:req.body?.count,
    });
    return res.json({ ...result, published:source.published, policyVersion:source.version });
  } catch(error) {return respondError(res,error);}
});
router.get("/admin", requireAdmin, (_req,res)=>{
  res.set("Cache-Control","private, no-store");
  try {return res.json(guides.adminState());}
  catch(error) {return respondError(res,error);}
});
router.put("/admin/draft", requireAdmin, sameOriginJson, (req,res)=>{
  res.set("Cache-Control","private, no-store");
  try {
    const doc = guides.saveDraft(req.body?.document,req.body?.expectedDraftVersion);
    return res.json({ok:true,...doc});
  } catch(error) {return respondError(res,error);}
});
router.post("/admin/publish", requireAdmin, sameOriginJson, (req,res)=>{
  res.set("Cache-Control","private, no-store");
  try {
    const result = guides.publish({
      expectedDraftVersion:req.body?.expectedDraftVersion,
      confirm:req.body?.confirm,
      adminSteamId:req.user?.steam_id,
    });
    return res.json({ok:true,...result});
  } catch(error) {return respondError(res,error);}
});
module.exports = router;
