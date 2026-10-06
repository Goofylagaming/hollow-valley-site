const express = require("express");
const { requireAuth } = require("../middleware/requireAuth");
const { buildOverlayState } = require("../services/territoryOverlayState");

const router = express.Router();

router.get("/overlay-state", requireAuth, (req, res) => {
  try {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    return res.json(buildOverlayState(req.user, {
      requestedMode: req.query?.view,
    }));
  } catch (error) {
    console.error("[territory-overlay] state failed:", error);
    return res.status(500).json({
      error: error?.message || "Territory Wars overlay state is unavailable",
    });
  }
});

module.exports = router;
