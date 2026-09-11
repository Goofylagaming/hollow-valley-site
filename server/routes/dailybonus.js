const express = require("express");
const { hasDailyBonusClaim, recordDailyBonusClaim, creditWallet, periodKeyFor, getSupporterStatus } = require("../db");
const { requireAuth } = require("../middleware/requireAuth");

const router = express.Router();

const BASE_MIN = 50;
const BASE_MAX = 250;

router.get("/", requireAuth, (req, res) => {
  const periodKey = periodKeyFor("daily");
  res.json({ claimed: hasDailyBonusClaim(req.user.id, periodKey), min: BASE_MIN, max: BASE_MAX });
});

router.post("/claim", requireAuth, (req, res) => {
  const periodKey = periodKeyFor("daily");
  if (hasDailyBonusClaim(req.user.id, periodKey)) {
    return res.status(409).json({ error: "Already claimed today's bonus" });
  }
  const supporter = getSupporterStatus(req.user.id);
  const multiplier = supporter && supporter.auto_renew ? { scout: 1.5, hunter: 2.5, apex: 4 }[supporter.tier] || 1 : 1;
  const amount = Math.round((BASE_MIN + Math.random() * (BASE_MAX - BASE_MIN)) * multiplier);

  recordDailyBonusClaim(req.user.id, periodKey, amount);
  const wallet = creditWallet(req.user.id, amount, "Daily bonus roll");
  res.json({ ok: true, amount, wallet });
});

module.exports = router;
