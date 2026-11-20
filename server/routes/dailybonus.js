const express = require("express");
const { requireAuth } = require("../middleware/requireAuth");
const dailyLogin = require("../services/dailyLoginGateway");

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
    return res.status(400).json({ error: "Your Steam account is not linked." });
  }
  try {
    return res.json(await dailyLogin.readDailyLogin(req.user));
  } catch (error) {
    return automationError(res, error, "Unable to read daily login bonus.");
  }
});

router.post("/claim", requireAuth, async (req, res) => {
  if (!req.user?.steam_id) {
    return res.status(400).json({ error: "Your Steam account is not linked." });
  }
  try {
    const result = await dailyLogin.claimDailyLogin(req.user, { explicit: true });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) {
    return automationError(res, error, "Unable to claim daily login bonus.");
  }
});

module.exports = router;
