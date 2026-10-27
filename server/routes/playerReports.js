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
router.get("/admin/:id", requireAdmin, (req, res) => {
  try {
    const result = reports.adminDetail(req.params.id);
    if (!result) return res.status(404).json({ error: "Report not found." });
    return res.json(result);
  } catch (error) { return respondError(res, error); }
});
router.post("/admin/:id/review", requireAdmin, requireSteam, sameOriginJson, (req, res) => {
  try {
    return res.json(reports.reviewReport(req.params.id, req.user, req.body?.status, req.body?.note));
  } catch (error) { return respondError(res, error); }
});
module.exports = router;
