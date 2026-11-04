const express = require("express");
const { verifyStripeSignature } = require("../services/supporterWebhook");
const { creditMonthlySubscriberBonus } = require("../services/supporterCoinBonus");
const { syncDiscordMembershipForUser } = require("../services/discordMembership");
const { processRewardEvent, enabled: rewardsEnabled } = require("../services/membershipRewards");
const { verifyInvoiceFunding } = require("../services/membershipPaymentVerification");
const discordQueue = require("../services/membershipDiscordQueue");
const { processLifecycle } = require("../services/supporterLifecycle");

const router = express.Router();

router.post("/", express.raw({ type: "application/json" }), async (req, res) => {
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
    const result = await processLifecycle(event);
    if (result?.ignored) return res.json({ received: true, ...result });
    // Separate paid-period ledger: retry independently of the lifecycle event
    // ledger, since an invoice can arrive before the account is linked.
    let rewardEvent = event;
    let membershipRewards;
    if (result.superseded) membershipRewards = { skipped: true, reason: "superseded-subscription" };
    if (!result.superseded && rewardsEnabled() && event.type === "invoice.paid" && Number(event.data?.object?.amount_paid) > 0) {
      const funding = await verifyInvoiceFunding(event.data.object);
      if (funding.verified) rewardEvent = { ...event, data: { ...event.data, object: { ...event.data.object, _membershipFunding: funding } } };
      else membershipRewards = { skipped: true, reason: funding.reason };
    }
    if (!membershipRewards) membershipRewards = processRewardEvent(rewardEvent);

    // Run this even when Stripe is retrying an event already recorded by the
    // membership webhook handler. The automation wallet uses the Stripe invoice
    // ID as an idempotency key, so retries can safely finish an interrupted
    // Valley Coin payout without ever paying twice.
    const monthlyBonus = result.superseded ? { skipped: true, reason: "superseded-subscription" } : await creditMonthlySubscriberBonus(event);

    const affectedUserId = result?.userId || membershipRewards?.userId;
    if (affectedUserId) {
      try {
        if (discordQueue.enabled()) discordQueue.enqueue(affectedUserId);
        else await syncDiscordMembershipForUser(affectedUserId);
      } catch (error) {
        console.warn("Discord membership sync warning:", error.message);
        throw error; // Stripe retries; duplicate lifecycle events still sync roles.
      }
    }
    return res.json({ received: true, ...result, monthlyBonus, membershipRewards });
  } catch (error) {
    console.error("Stripe webhook processing failed:", error.message);
    return res.status(500).json({ error: "Webhook processing failed." });
  }
});

module.exports = router;
