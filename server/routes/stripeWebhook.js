const express = require("express");
const { verifyStripeSignature, processStripeEvent } = require("../services/supporterWebhook");

const router = express.Router();

router.post("/", express.raw({ type: "application/json" }), (req, res) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET || "";
  const signature = req.get("stripe-signature");

  if (!secret) {
    return res.status(503).json({ error: "Stripe webhook is not configured." });
  }
  if (!verifyStripeSignature(req.body, signature, secret)) {
    return res.status(400).json({ error: "Invalid Stripe webhook signature." });
  }

  let event;
  try {
    event = JSON.parse(req.body.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Invalid webhook payload." });
  }

  try {
    const result = processStripeEvent(event);
    return res.json({ received: true, ...result });
  } catch (error) {
    console.error("Stripe webhook processing failed:", error.message);
    return res.status(500).json({ error: "Webhook processing failed." });
  }
});

module.exports = router;
