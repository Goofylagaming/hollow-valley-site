const express = require("express");
const { getWallet: getLegacyWallet } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/requireAuth");
const automation = require("../services/automationWebsiteClient");

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  if (!req.user?.steam_id) {
    return res.json(getLegacyWallet(req.user.id));
  }

  try {
    const wallet = await automation.getWallet(String(req.user.steam_id));
    return res.json(wallet);
  } catch (error) {
    if (error?.code === "AUTOMATION_TIMEOUT") {
      return res.status(504).json({ error: "The automation wallet did not respond in time." });
    }
    if (Number.isInteger(error?.status)) {
      return res.status(error.status).json({ error: error.message || "Unable to read Valley Coin wallet." });
    }
    return res.status(502).json({ error: error?.message || "Unable to read Valley Coin wallet." });
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
    if (error?.code === "AUTOMATION_TIMEOUT") {
      return res.status(504).json({ error: "The automation service did not respond in time." });
    }
    if (Number.isInteger(error?.status)) {
      return res.status(error.status).json({ error: error.message || "Unable to credit Valley Coin." });
    }
    return res.status(502).json({ error: error?.message || "Unable to credit Valley Coin." });
  }
});

module.exports = router;
