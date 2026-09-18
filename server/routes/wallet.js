const express = require("express");
const { getWallet: getLegacyWallet } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/requireAuth");
const automation = require("../services/automationWebsiteClient");

const router = express.Router();

function automationError(res, error, fallback) {
  if (error?.code === "AUTOMATION_TIMEOUT") {
    return res.status(504).json({ error: "The automation service did not respond in time." });
  }
  if (Number.isInteger(error?.status)) {
    return res.status(error.status).json({ error: error.message || fallback });
  }
  return res.status(502).json({ error: error?.message || fallback });
}

router.get("/", requireAuth, async (req, res) => {
  if (!req.user?.steam_id) {
    return res.json(getLegacyWallet(req.user.id));
  }

  try {
    const wallet = await automation.getWallet(String(req.user.steam_id));
    return res.json(wallet);
  } catch (error) {
    return automationError(res, error, "Unable to read Valley Coin wallet.");
  }
});

router.get("/daily-login", requireAuth, async (req, res) => {
  if (!req.user?.steam_id) {
    return res.status(400).json({ error: "Your Steam account is not linked." });
  }
  try {
    return res.json(await automation.getDailyLoginBonus(String(req.user.steam_id)));
  } catch (error) {
    return automationError(res, error, "Unable to read daily login bonus.");
  }
});

router.post("/daily-login/claim", requireAuth, async (req, res) => {
  if (!req.user?.steam_id) {
    return res.status(400).json({ error: "Your Steam account is not linked." });
  }
  try {
    const result = await automation.claimDailyLoginBonus(String(req.user.steam_id));
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) {
    return automationError(res, error, "Unable to claim daily login bonus.");
  }
});

router.post("/admin-credit", requireAdmin, async (req, res) => {
  if (!req.user.steam_id) {
    return res.status(400).json({ error: "Your Steam account is not linked." });
  }

  const amount = Number(req.body?.amount);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000) {
    return res.status(400).json({ error: "Credit amount must be a whole number between 1 and 1,000,000." });
  }

  try {
    const result = await automation.adminCreditWallet({
      steamId: String(req.user.steam_id),
      amount,
    });
    return res.status(201).json({
      ok: true,
      amount,
      wallet: result.wallet || null,
      transaction: result.transaction || null,
    });
  } catch (error) {
    return automationError(res, error, "Unable to credit Valley Coin.");
  }
});

module.exports = router;
