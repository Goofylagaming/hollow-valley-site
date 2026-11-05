const express = require("express");
const { requireAuth } = require("../middleware/requireAuth");
const serverStatus = require("../services/serverStatus");
const automation = require("../services/automationWebsiteClient");
const projection = require("../services/liveMapProjection");

const router = express.Router();

router.get("/activity", async (req, res) => {
  try {
    const hours = Math.max(1, Math.min(24 * 31, Number(req.query.hours) || 24));
    return res.json(await automation.getMapActivity({ hours }));
  } catch (error) {
    return res.status(502).json({
      error: error?.message || "Verified activity history is unavailable.",
      trackingEnabled: false,
      hours: 24,
      sampleCount: 0,
      uniquePlayers: 0,
      sessions: 0,
      averageOnline: 0,
      peakConcurrent: 0,
      topSpecies: [],
      activityTrend: [],
      lastVerifiedAt: null,
    });
  }
});

router.get("/positions", requireAuth, (req, res) => {
  res.set("Cache-Control", "private, no-store");
  try { return res.json(projection.positions(serverStatus.getState(), req.user)); }
  catch { return res.status(503).json({error:"Live map data is unavailable",connected:false,me:null,others:[]}); }
});

module.exports = router;
