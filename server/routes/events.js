const express = require("express");
const { requireAuth, requireAdmin } = require("../middleware/requireAuth");
const { listSteamLinkedUsers } = require("../db");
const automation = require("../services/automationWebsiteClient");

const router = express.Router();
const EVENT_CACHE_CONTROL = "public, max-age=30, stale-while-revalidate=120";

router.get("/", async (_req, res) => {
  try {
    const data = await automation.getDiscordScheduledEvents();
    res.set("Cache-Control", EVENT_CACHE_CONTROL);
    return res.json({
      configured: data.configured === true,
      stale: data.stale === true,
      syncedAt: data.syncedAt || null,
      ageSeconds: data.ageSeconds ?? null,
      events: Array.isArray(data.events) ? data.events : [],
    });
  } catch (error) {
    console.error("[events] automation event cache unavailable:", error.message);
    return res.status(502).json({
      error: "Discord events could not be loaded right now.",
      configured: false,
      stale: true,
      events: [],
    });
  }
});

module.exports = router;


router.get("/rewards/mine", requireAuth, async (req, res) => {
  if (!req.user?.steam_id) {
    return res.status(400).json({ error: "Your Steam account is not linked." });
  }

  try {
    return res.json(await automation.getEventRewards(String(req.user.steam_id)));
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 502;
    return res.status(status).json({ error: error.message || "Could not load event reward history." });
  }
});

router.get("/admin/players", requireAdmin, (req, res) => {
  const players = listSteamLinkedUsers({
    query: req.query.q,
    limit: Number(req.query.limit) || 200,
  }).map((row) => ({
    id: row.id,
    steamId: row.steam_id,
    username: row.username,
    avatar: row.avatar || null,
  }));
  res.json({ players });
});

router.get("/admin/rewards", requireAdmin, async (req, res) => {
  try {
    return res.json(await automation.getAdminEventRewards({ limit: Number(req.query.limit) || 100 }));
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 502;
    return res.status(status).json({ error: error.message || "Could not load event reward administration." });
  }
});

router.post("/admin/reward", requireAdmin, async (req, res) => {
  try {
    const result = await automation.awardAdminEventReward({
      steamId: req.body?.steamId,
      eventId: req.body?.eventId,
      eventTitle: req.body?.eventTitle,
      baseAmount: req.body?.baseAmount,
    });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 502;
    return res.status(status).json({
      error: error.message || "Could not issue event reward.",
      code: error?.payload?.code || error?.code || null,
    });
  }
});
