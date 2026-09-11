// Supporter subscriptions. Real billing requires a Stripe account — this route degrades
// gracefully (like Discord login) until STRIPE_SECRET_KEY is configured, so nothing here
// fakes a purchase or grants Valley Coin without an actual payment.
const express = require("express");
const { getSupporterStatus, cancelSupporterAutoRenew } = require("../db");
const { requireAuth } = require("../middleware/requireAuth");

const router = express.Router();

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const isConfigured = Boolean(STRIPE_SECRET_KEY);

const TIERS = {
  scout: { label: "Scout", priceAud: 4.99, coinMultiplier: 1.5 },
  hunter: { label: "Hunter", priceAud: 9.99, coinMultiplier: 2.5 },
  apex: { label: "Apex Predator", priceAud: 19.99, coinMultiplier: 4 },
};

router.get("/tiers", (req, res) => {
  res.json({ tiers: TIERS, checkoutConfigured: isConfigured });
});

router.get("/", requireAuth, (req, res) => {
  res.json(getSupporterStatus(req.user.id));
});

router.post("/:tier/checkout", requireAuth, (req, res) => {
  if (!TIERS[req.params.tier]) return res.status(404).json({ error: "Unknown supporter tier" });
  if (!isConfigured) {
    return res
      .status(503)
      .json({ error: "Supporter checkout is not configured yet. Set STRIPE_SECRET_KEY to accept real payments." });
  }
  // With STRIPE_SECRET_KEY set, this would create a Stripe Checkout Session and return its URL
  // for the client to redirect to; the webhook handler would call setSupporterTier() on success.
  res.status(501).json({ error: "Stripe checkout session creation not yet implemented." });
});

router.post("/cancel", requireAuth, (req, res) => {
  res.json(cancelSupporterAutoRenew(req.user.id));
});

module.exports = router;
