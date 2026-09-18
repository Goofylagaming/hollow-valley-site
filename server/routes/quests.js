const express = require("express");
const { requireAuth } = require("../middleware/requireAuth");
const automationRoutes = require("../../automation-platform/integration/liveRouteAdapters");

const router = express.Router();

router.get("/", requireAuth, (req, res) => automationRoutes.getQuests(req, res));

// Legacy manual claims are deliberately disabled. Playtime quests are completed
// automatically from verified RCON presence and cannot be manually claimed.
router.post("/:id/claim", requireAuth, (_req, res) => {
  res.status(410).json({ error: "Playtime quests complete automatically and no longer use manual claims." });
});

module.exports = router;
