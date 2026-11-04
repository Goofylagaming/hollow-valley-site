const express = require("express");
const { db } = require("../db");
const { loadStripeFinance } = require("../services/stripeFinance");

// The entire router is mounted behind requireFinanceOwner in server/index.js.
const router = express.Router();

router.get("/", async (_req, res) => {
  try {
    const rows = db.prepare(
      "SELECT s.stripe_subscription_id AS subscriptionId, u.username " +
      "FROM supporter_subscriptions s " +
      "JOIN users u ON u.id = s.user_id " +
      "WHERE s.stripe_subscription_id IS NOT NULL"
    ).all();
    const websiteNames = new Map(rows.map((row) => [String(row.subscriptionId), row.username]));
    return res.json(await loadStripeFinance({ websiteNames }));
  } catch (error) {
    // Deliberately avoid logging error details from payment providers.
    const status = error?.status === 503 ? 503 : 502;
    return res.status(status).json({
      error: status === 503
        ? "Stripe finance reporting is not configured."
        : "Could not load Stripe financial data. Check Stripe read permissions and try again.",
    });
  }
});

module.exports = router;
