const express = require("express");
const { requireAuth } = require("../middleware/requireAuth");
const automationRoutes = require("../../automation-platform/integration/liveRouteAdapters");

const router = express.Router();

router.get("/", requireAuth, (req, res) => automationRoutes.getDailyLoginBonus(req, res));
router.post("/claim", requireAuth, (req, res) => automationRoutes.claimDailyLoginBonus(req, res));

module.exports = router;
