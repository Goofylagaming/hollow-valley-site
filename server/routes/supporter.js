// Hollow Valley membership checkout and sandbox subscription management.
const express = require("express");
const { getSupporterStatus, cancelSupporterAutoRenew } = require("../db");
const { requireAuth } = require("../middleware/requireAuth");
const { TIERS, checkoutConfigured, createCheckoutSession, CheckoutError } = require("../services/supporterCheckout");
const { isEntitled } = require("../services/supporterWebhook");
const {
  ManageError,
  changeSubscription,
  cancelSubscription,
  resumeSubscription,
} = require("../services/supporterManage");
const { ReconcileError, reconcileCurrentUser } = require("../services/supporterReconcile");

const router = express.Router();

function hasExistingStripeSubscription(status) {
  return Boolean(
    status?.stripe_subscription_id &&
    !["canceled", "incomplete_expired"].includes(status.stripe_status)
  );
}

function sendManageError(res, error) {
  return res.status(error instanceof ManageError ? error.status : 500).json({
    error: error instanceof ManageError ? error.message : "Unable to update membership.",
  });
}

router.get("/tiers", (req, res) => {
  res.json({ tiers: TIERS, checkoutConfigured: checkoutConfigured() });
});

router.get("/", requireAuth, (req, res) => {
  const status = getSupporterStatus(req.user.id);
  if (!status) return res.json(null);
  const tier = TIERS[status.tier];
  res.json({
    tier: status.tier,
    tierLabel: tier?.label || status.tier,
    auto_renew: Boolean(status.auto_renew),
    renews_at: status.renews_at,
    cancelled_at: status.cancelled_at,
    stripe_status: status.stripe_status,
    entitled: isEntitled(status.stripe_status),
    managed: Boolean(status.stripe_subscription_id),
  });
});

router.post("/reconcile", requireAuth, async (req, res) => {
  try {
    res.json(await reconcileCurrentUser({
      userId: req.user.id,
      steamId: req.user.steam_id || null,
    }));
  } catch (error) {
    res.status(error instanceof ReconcileError ? error.status : 500).json({
      error: error instanceof ReconcileError ? error.message : "Unable to recover membership.",
    });
  }
});

router.post("/:tier/checkout", requireAuth, async (req, res) => {
  const status = getSupporterStatus(req.user.id);
  if (hasExistingStripeSubscription(status)) {
    return res.status(409).json({
      error: "You already have a Stripe membership. Change your existing membership instead of starting another subscription.",
    });
  }

  try {
    res.json(await createCheckoutSession({ tier: req.params.tier, userId: req.user.id }));
  } catch (error) {
    res.status(error instanceof CheckoutError ? error.status : 500).json({
      error: error instanceof CheckoutError ? error.message : "Unable to start checkout.",
    });
  }
});

router.post("/:tier/change", requireAuth, async (req, res) => {
  const status = getSupporterStatus(req.user.id);
  if (!hasExistingStripeSubscription(status)) {
    return res.status(409).json({ error: "No active Stripe membership was found to change." });
  }

  try {
    res.json(await changeSubscription({
      subscriptionId: status.stripe_subscription_id,
      tier: req.params.tier,
      userId: req.user.id,
    }));
  } catch (error) {
    sendManageError(res, error);
  }
});

router.post("/cancel", requireAuth, async (req, res) => {
  const status = getSupporterStatus(req.user.id);
  if (!status?.stripe_subscription_id) {
    return res.json(cancelSupporterAutoRenew(req.user.id));
  }

  try {
    res.json(await cancelSubscription({
      subscriptionId: status.stripe_subscription_id,
      userId: req.user.id,
    }));
  } catch (error) {
    sendManageError(res, error);
  }
});

router.post("/resume", requireAuth, async (req, res) => {
  const status = getSupporterStatus(req.user.id);
  if (!hasExistingStripeSubscription(status)) {
    return res.status(409).json({ error: "No Stripe membership was found to resume." });
  }

  try {
    res.json(await resumeSubscription({
      subscriptionId: status.stripe_subscription_id,
      userId: req.user.id,
    }));
  } catch (error) {
    sendManageError(res, error);
  }
});

module.exports = router;
