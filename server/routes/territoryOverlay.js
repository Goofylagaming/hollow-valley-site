const express = require("express");
const { requireAuth } = require("../middleware/requireAuth");
const { buildOverlayState } = require("../services/territoryOverlayState");
const { isAuthorized: isTerritoryAdmin } = require("../middleware/requireTerritoryAdmin");

const router = express.Router();

router.get("/overlay-state", requireAuth, (req, res) => {
  try {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    const preview = ["1", "true", "yes", "on"].includes(
      String(req.query?.preview || "").trim().toLowerCase()
    );
    const previewTerritory = String(req.query?.territory || "").trim().slice(0, 80);

    // Only the four authorised Territory Wars admins receive preview controls
    // or exact admin fighter intelligence, even if other site admins exist.
    if (!/^\d{17}$/.test(String(req.user?.steam_id || ""))) {
      return res.status(403).json({ error: "Steam login required for Territory Wars map" });
    }
    const safeUser = { ...req.user, is_admin: isTerritoryAdmin(req.user) ? 1 : 0 };
    return res.json(buildOverlayState(safeUser, {
      requestedMode: req.query?.view,
      preview: preview && safeUser.is_admin === 1,
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
