const express = require("express");
const { getWallet: getLegacyWallet } = require("../db");
const { requireAuth } = require("../middleware/requireAuth");
const automationRoutes = require("../../automation-platform/integration/liveRouteAdapters");

const router = express.Router();

router.get("/", requireAuth, (req, res) => automationRoutes.getWallet(req, res, {
  legacyWallet: getLegacyWallet(req.user.id),
}));

module.exports = router;
