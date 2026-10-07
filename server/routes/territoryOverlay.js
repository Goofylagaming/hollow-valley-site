const express = require("express");
const { requireAuth } = require("../middleware/requireAuth");
const { buildOverlayState } = require("../services/territoryOverlayState");

const router = express.Router();

router.get("/overlay-state", requireAuth, (req, res) => {
  try {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    const preview = ["1", "true", "yes", "on"].includes(
      String(req.query?.preview || "").trim().toLowerCase()
    );
    const previewTerritory = String(req.query?.territory || "").trim().slice(0, 80);

    return res.json(buildOverlayState(req.user, {
      requestedMode: req.query?.view,
      preview,
      previewTerritory,
    }));
  } catch (error) {
    console.error("[territory-overlay] state failed:", error);
    return res.status(500).json({
      error: error?.message || "Territory Wars overlay state is unavailable",
    });
  }
});

module.exports = router;
