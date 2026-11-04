const express = require("express");
const { getDashboardSummary } = require("../db");
const { requireAuth } = require("../middleware/requireAuth");
const { TIERS, normalizeTier, supporterMultiplier } = require("../services/supporterTiers");
const { isCoinBonusEligible, isEntitled } = require("../services/supporterWebhook");

const router = express.Router();

router.get("/", requireAuth, (req, res) => {
  const summary = getDashboardSummary(req.user.id);
  if (summary.supporter) {
    const canonicalTier = normalizeTier(summary.supporter.tier);
    const tier = canonicalTier ? TIERS[canonicalTier] : null;
    summary.supporter = {
      ...summary.supporter,
      tier: canonicalTier || summary.supporter.tier,
      tierLabel: tier?.label || summary.supporter.tier,
      multiplier: isCoinBonusEligible(summary.supporter) ? supporterMultiplier(canonicalTier) : 1,
      coinBonusEligible: isCoinBonusEligible(summary.supporter),
      entitled: isEntitled(summary.supporter),
    };
  }
  res.json(summary);
});

module.exports = router;
