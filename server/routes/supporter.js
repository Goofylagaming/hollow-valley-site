// Checkout creation does not grant entitlements or change local subscriptions.
const express = require("express");
const { getSupporterStatus, cancelSupporterAutoRenew } = require("../db");
const { requireAuth } = require("../middleware/requireAuth");
const { TIERS, checkoutConfigured, createCheckoutSession, CheckoutError } = require("../services/supporterCheckout");

const router = express.Router();

router.get("/tiers", (req, res) => {
  res.json({ tiers: TIERS, checkoutConfigured: checkoutConfigured() });
});

router.get("/", requireAuth, (req, res) => {
  res.json(getSupporterStatus(req.user.id));
});

router.post("/:tier/checkout", requireAuth, async (req, res) => {
  try {
    res.json(await createCheckoutSession({ tier: req.params.tier, userId: req.user.id }));
  } catch (error) {
    res.status(error instanceof CheckoutError ? error.status : 500).json({
      error: error instanceof CheckoutError ? error.message : "Unable to start checkout.",
    });
  }
});

router.post("/cancel", requireAuth, (req, res) => {
  res.json(cancelSupporterAutoRenew(req.user.id));
});

module.exports = router;
