"use strict";
const express = require("express");
const { requireAdmin } = require("../middleware/requireAuth");
const automation = require("../services/automationWebsiteClient");
const timeline = require("../services/incidentTimeline");

const router = express.Router();
router.use((_req,res,next) => { res.set('Cache-Control', 'private, no-store'); next(); });
router.use(requireAdmin);

function contextError(res, error) {
  const status = [400,403,503].includes(error.status) ? error.status : 502;
  return res.status(status).json({error: status === 400 ? 'A valid player and approximate incident time are required.' : status === 403 ? 'Current linked admin access is required. Reload incident history.' : status === 503 ? 'Player incident context is not enabled.' : 'Player incident sources are unavailable.'});
}
router.get('/player-context-capabilities', (req,res) => {
  res.set('Cache-Control', 'private, no-store');
  try { return res.json(require('../services/incidentPlayerContext').getDefaultReader().capabilities(() => req.user)); }
  catch (error) { return contextError(res,error); }
});
router.get('/player-context', async (req,res) => {
  res.set('Cache-Control', 'private, no-store');
  try { return res.json(await require('../services/incidentPlayerContext').getDefaultReader().read(() => req.user, req.get('X-Incident-Reviewer'), req.query)); }
  catch (error) { return contextError(res,error); }
});

// Read-only, bounded and protected by the existing website admin session.
// The automation API currently exposes only its newest 200 audit entries and
// 100 requests; the UI must not suggest a complete lifetime investigation.
router.get("/timeline", async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  const results = await Promise.allSettled([
    automation.getAdminAudit({ limit: timeline.AUDIT_LIMIT }),
    automation.getAdminRequests({ limit: timeline.REQUEST_LIMIT }),
  ]);
  if (results.every(item => item.status === "rejected")) {
    return res.status(502).json({ error: "Incident sources are unavailable. No records were changed." });
  }

  const auditRows = results[0].status === "fulfilled" && Array.isArray(results[0].value?.audit)
    ? results[0].value.audit : [];
  const requestRows = results[1].status === "fulfilled" && Array.isArray(results[1].value?.requests)
    ? results[1].value.requests : [];
  const data = timeline.buildTimeline(auditRows, requestRows, {
    source: req.query.source,
    status: req.query.status,
    q: req.query.q,
    limit: req.query.limit,
  });
  return res.json({
    ...data,
    partialSources: results.flatMap((item, i) => item.status === "rejected" ? [i === 0 ? "audit" : "requests"] : []),
    fetchedAt: new Date().toISOString(),
  });
});

module.exports = router;
