"use strict";
const express = require("express");
const { timingSafeEqual } = require("node:crypto");
const { requireAdmin } = require("../middleware/requireAuth");
const updates = require("../services/siteUpdates");

const router=express.Router();
function sameOriginJson(req,res,next) {
  let expected;
  try { expected=process.env.PUBLIC_SITE_URL ? new URL(process.env.PUBLIC_SITE_URL).origin :
    req.protocol+"://"+req.get("Host"); }
  catch { return res.status(500).json({error:"Website origin is not configured."}); }
  if (!req.get("Origin") || req.get("Origin")!==expected)
    return res.status(403).json({error:"Publish updates through the Hollow Valley website only."});
  if (!req.is("application/json")) return res.status(415).json({error:"Send JSON to update the changelog."});
  return next();
}
function mapError(res,error) {
  const status=error.code==="NOT_FOUND"?404 :
    ["ALREADY_PUBLISHED","EDIT_CONFLICT"].includes(error.code)?409 :
    error.code==="STEAM_ADMIN_REQUIRED"?403 :
    ["INVALID_UPDATE","STAGE_RESTRICTED","CONFIRM_REQUIRED","RELEASE_DISABLED",
      "REVISION_MISMATCH"].includes(error.code)?400 : 500;
  if(status===500)console.error("[site-updates] request failed",error);
  return res.status(status).json({
    code:status===500?"UPDATES_UNAVAILABLE":error.code,
    error:status===500?"Site updates are temporarily unavailable.":error.message,
  });
}
function secureCompare(a,b) {
  const aa=Buffer.from(String(a||""),"utf8"),bb=Buffer.from(String(b||""),"utf8");
  return aa.length>0 && aa.length===bb.length && timingSafeEqual(aa,bb);
}
function requireReleaseToken(req,res,next) {
  const token=String(process.env.HV_SITE_UPDATES_TOKEN||"");
  if (token.length<32 || process.env.SITE_UPDATES_AUTO_RELEASE_ENABLED!=="true") {
    return res.status(503).json({error:"Automatic release updates are not configured."});
  }
  const received=/^Bearer\s+(\S+)$/i.exec(req.get("authorization")||"")?.[1] || "";
  if (!secureCompare(token,received)) return res.status(401).json({error:"Unauthorized release feed."});
  next();
}
router.use((_req,res,next)=>{res.set("Cache-Control","no-store");next();});
router.get("/", (req,res)=>{
  try {return res.json(updates.listPublic(req.query));}
  catch(error){return mapError(res,error);}
});
router.get("/admin",requireAdmin,(_req,res)=>{
  res.set("Cache-Control","private, no-store");
  try {return res.json(updates.listAdmin());}
  catch(error){return mapError(res,error);}
});
router.get("/admin/:id/history",requireAdmin,(req,res)=>{
  res.set("Cache-Control","private, no-store");
  try {return res.json({events:updates.auditHistory(req.params.id)});}
  catch(error){return mapError(res,error);}
});
router.post("/admin",requireAdmin,sameOriginJson,(req,res)=>{
  res.set("Cache-Control","private, no-store");
  try {return res.status(201).json({update:updates.draft(req.user,req.body)});}
  catch(error){return mapError(res,error);}
});
router.put("/admin/:id",requireAdmin,sameOriginJson,(req,res)=>{
  res.set("Cache-Control","private, no-store");
  try {return res.json({update:updates.updateDraft(req.user,req.params.id,req.body?.update,req.body?.expectedRevision)});}
  catch(error){return mapError(res,error);}
});
router.post("/admin/:id/publish",requireAdmin,sameOriginJson,(req,res)=>{
  res.set("Cache-Control","private, no-store");
  try {return res.json({update:updates.publishDraft(req.user,req.params.id,req.body)});}
  catch(error){return mapError(res,error);}
});
// Server-to-server only. The user session never authorizes a LIVE label.
// A GitHub Action must verify three /readyz responses for the same SHA first.
router.post("/release",requireReleaseToken,(req,res)=>{
  if (!req.is("application/json")) return res.status(415).json({error:"Release notifications must use JSON."});
  try {return res.status(202).json({update:updates.recordVerifiedRelease({sha:req.body?.sha})});}
  catch(error){return mapError(res,error);}
});
module.exports=router;
module.exports.secureCompare=secureCompare;
