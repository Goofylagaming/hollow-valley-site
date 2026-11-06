"use strict";
const express = require("express");
const { requireAuth, requireAdmin } = require("../middleware/requireAuth");
const reports = require("../services/playerReports");

const router = express.Router();
function sameOriginJson(req, res, next) {
  let expected;
  try {
    expected = process.env.PUBLIC_SITE_URL
      ? new URL(process.env.PUBLIC_SITE_URL).origin
      : req.protocol + "://" + req.get("Host");
  } catch { return res.status(500).json({ error: "Website origin is misconfigured." }); }
  if (!req.get("Origin") || req.get("Origin") !== expected) {
    return res.status(403).json({ error: "Submit reports from the Hollow Valley website only." });
  }
  if (!req.is("application/json")) {
    return res.status(415).json({ error: "Report requests must use JSON." });
  }
  next();
}
function requireSteam(req, res, next) {
  if (!/^\d{17}$/.test(String(req.user?.steam_id || ""))) {
    return res.status(403).json({ error: "A linked Steam account is required." });
  }
  next();
}
function respondError(res, error) {
  const status = error.code === "REPORT_LIMIT" ? 429
    : error.code === "REPORTS_DISABLED" ? 503
    : error.code === "NOT_FOUND" ? 404
    : error.code === "ADMIN_REQUIRED" ? 403
    : ["INVALID_REPORT", "INVALID_EVIDENCE", "INVALID_REVIEW", "STEAM_REQUIRED"].includes(error.code) ? 400
    : 500;
  if (status === 500) console.error("[player-reports] write failed", error);
  res.status(status).json({
    code: status === 500 ? "REPORTS_UNAVAILABLE" : error.code,
    error: status === 500 ? "Reports are temporarily unavailable." : error.message,
  });
}
router.use((_req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  next();
});
router.get("/capabilities", (_req, res) => {
  res.json({ enabled: reports.submissionsEnabled(), evidence: "HTTPS links from approved media providers, up to three" });
});
router.get("/mine", requireAuth, requireSteam, (req, res) => {
  try { res.json({ reports: reports.listMine(req.user) }); }
  catch (error) { respondError(res, error); }
});
router.post("/", requireAuth, requireSteam, sameOriginJson, (req, res) => {
  try { res.status(201).json({ report: reports.createReport(req.user, req.body) }); }
  catch (error) { respondError(res, error); }
});
router.get("/admin", requireAdmin, (req, res) => {
  try { res.json({ reports: reports.listAdmin({ status: req.query.status, q: req.query.q, limit: req.query.limit }) }); }
  catch (error) { respondError(res, error); }
});
router.get('/admin/context-capabilities', requireAuth, requireSteam, (req,res)=>{
  try{return res.json(require('../services/reportContext').getDefaultReader().capabilities(()=>req.user));}
  catch(error){return res.status(error.status===403?403:503).json({error:error.status===403?'Current linked admin access is required.':'Report context is unavailable.'});}
});
router.get('/admin/:id/context', requireAuth, requireSteam, async (req,res)=>{
  if(Object.keys(req.query).length)return res.status(400).json({error:'Context uses the saved report only.'});
  try{return res.json(await require('../services/reportContext').getDefaultReader().read(()=>req.user,req.params.id,req.get('X-Report-Reviewer')));}
  catch(error){const status=[400,403,404,409,502,503].includes(error.status)?error.status:503;return res.status(status).json({error:status===503?'Report context is unavailable.':error.message});}
});
function snapshotError(res,error){const status=[400,403,404,409,410,429,502,503].includes(error.status)?error.status:503;return res.status(status).json({error:status===503?'Saved report context is unavailable.':error.message});}
router.get('/admin/:id/context-snapshots', requireAuth, requireSteam, (req,res)=>{
  if(Object.keys(req.query).length)return res.status(400).json({error:'Saved context uses the report reference only.'});
  try{const binding=req.get('X-Report-Reviewer'),result=require('../services/reportContextSnapshots').getDefaultStore().list(()=>req.user,req.params.id,binding);return res.json({reportId:req.params.id,reviewerBinding:binding,...result});}catch(error){return snapshotError(res,error);}
});
router.get('/admin/:id/context-snapshots/:snapshotId', requireAuth, requireSteam, (req,res)=>{
  if(Object.keys(req.query).length)return res.status(400).json({error:'Saved context uses the report reference only.'});
  try{const binding=req.get('X-Report-Reviewer'),snapshot=require('../services/reportContextSnapshots').getDefaultStore().read(()=>req.user,req.params.id,binding,req.params.snapshotId);return res.json({available:true,reportId:req.params.id,reviewerBinding:binding,snapshot});}catch(error){return snapshotError(res,error);}
});
router.post('/admin/:id/context-snapshots', requireAuth, requireSteam, sameOriginJson, (req,res)=>{
  if(Object.keys(req.query).length)return res.status(400).json({error:'Saved context uses the report reference only.'});
  try{const binding=req.get('X-Report-Reviewer'),snapshot=require('../services/reportContextSnapshots').getDefaultStore().save(()=>req.user,req.params.id,binding,req.body);return res.json({reportId:req.params.id,reviewerBinding:binding,snapshot});}catch(error){return snapshotError(res,error);}
});
router.get("/admin/:id", requireAdmin, (req, res) => {
  try {
    const result = reports.adminDetail(req.params.id);
    if (!result) return res.status(404).json({ error: "Report not found." });
    return res.json(result);
  } catch (error) { return respondError(res, error); }
});
router.post("/admin/:id/review", requireAdmin, requireSteam, sameOriginJson, (req, res) => {
  const reviewer=req.get("X-Report-Reviewer");if(reviewer&&reviewer!==req.user.id+":"+req.user.steam_id)return res.status(403).json({error:"The admin account changed. Reload reports."});
  try {
    return res.json(reports.reviewReport(req.params.id, req.user, req.body?.status, req.body?.note));
  } catch (error) { return respondError(res, error); }
});
module.exports = router;
