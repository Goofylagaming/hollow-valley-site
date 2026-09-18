// Checkout creation does not grant entitlements or change local subscriptions.
const express = require("express");
const { getSupporterStatus, cancelSupporterAutoRenew } = require("../db");
const { requireAuth } = require("../middleware/requireAuth");
const { TIERS, checkoutConfigured, createCheckoutSession, CheckoutError } = require("../services/supporterCheckout");
const { isEntitled } = require("../services/supporterWebhook");

const router = express.Router();

router.get("/tiers", (req, res) => {
  res.json({ tiers: TIERS, checkoutConfigured: checkoutConfigured() });
});

router.get("/", requireAuth, (req, res) => {
  const status = getSupporterStatus(req.user.id);
  if (!status) return res.json(null);
  const tier = TIERS[status.tier];
  res.json({
    ...status,
    tierLabel: tier?.label || status.tier,
    entitled: isEntitled(status.stripe_status),
  });
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
  const status = getSupporterStatus(req.user.id);
  if (status?.stripe_subscription_id) {
    return res.status(501).json({
      error: "Stripe subscription cancellation is not enabled on the test site yet.",
    });
  }
  res.json(cancelSupporterAutoRenew(req.user.id));
});

module.exports = router;
