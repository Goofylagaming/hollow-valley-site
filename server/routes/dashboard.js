const express = require("express");
const { getDashboardSummary } = require("../db");
const { requireAuth } = require("../middleware/requireAuth");

const router = express.Router();

router.get("/", requireAuth, (req, res) => {
  res.json(getDashboardSummary(req.user.id));
});

module.exports = router;
