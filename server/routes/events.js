const express = require("express");
const { requireAuth, requireAdmin } = require("../middleware/requireAuth");
const { listSteamLinkedUsers } = require("../db");
const automation = require("../services/automationWebsiteClient");

const router = express.Router();
const EVENT_CACHE_CONTROL = "public, max-age=30, stale-while-revalidate=120";

function actorSteamId(req) {
  const steamId = String(req.user?.steam_id || "").trim();
  return /^\d{17}$/.test(steamId) ? steamId : null;
}

function proxyError(res, error, fallback) {
  const status = Number.isInteger(error?.status) ? error.status : 502;
  return res.status(status).json({
    error: error.message || fallback,
    code: error?.payload?.code || error?.code || null,
  });
}

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

router.get("/rewards/mine", requireAuth, async (req, res) => {
  if (!req.user?.steam_id) return res.status(400).json({ error: "Your Steam account is not linked." });
  try {
    return res.json(await automation.getEventRewards(String(req.user.steam_id)));
  } catch (error) {
    return proxyError(res, error, "Could not load event reward history.");
  }
});

router.get("/attendance/mine", requireAuth, async (req, res) => {
  if (!req.user?.steam_id) return res.status(400).json({ error: "Your Steam account is not linked." });
  try {
    return res.json(await automation.getEventAttendance(String(req.user.steam_id)));
  } catch (error) {
    return proxyError(res, error, "Could not load your event attendance.");
  }
});

router.post("/attendance", requireAuth, async (req, res) => {
  if (!req.user?.steam_id) return res.status(400).json({ error: "Your Steam account is not linked." });
  try {
    const result = await automation.setEventAttendance({
      steamId: String(req.user.steam_id),
      eventId: req.body?.eventId,
      eventTitle: req.body?.eventTitle,
      eventStart: req.body?.eventStart || null,
      eventEnd: req.body?.eventEnd || null,
      attending: req.body?.attending !== false,
    });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) {
    return proxyError(res, error, "Could not update event attendance.");
  }
});

router.get("/admin/players", requireAdmin, (req, res) => {
  const players = listSteamLinkedUsers({
    query: req.query.q,
    limit: Number(req.query.limit) || 300,
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
    return proxyError(res, error, "Could not load event reward administration.");
  }
});

router.get("/admin/attendance", requireAdmin, async (req, res) => {
  try {
    return res.json(await automation.getAdminEventAttendance({
      eventId: String(req.query.eventId || "").trim() || null,
      limit: Number(req.query.limit) || 500,
    }));
  } catch (error) {
    return proxyError(res, error, "Could not load event attendance administration.");
  }
});

router.post("/admin/attendance/add", requireAdmin, async (req, res) => {
  try {
    const result = await automation.addAdminEventAttendee({
      steamId: req.body?.steamId,
      eventId: req.body?.eventId,
      eventTitle: req.body?.eventTitle,
      eventStart: req.body?.eventStart || null,
      eventEnd: req.body?.eventEnd || null,
      addedBySteamId: actorSteamId(req),
    });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) {
    return proxyError(res, error, "Could not add event attendee.");
  }
});

router.post("/admin/attendance/remove", requireAdmin, async (req, res) => {
  try {
    return res.json(await automation.removeAdminEventAttendee({
      steamId: req.body?.steamId,
      eventId: req.body?.eventId,
      removedBySteamId: actorSteamId(req),
    }));
  } catch (error) {
    return proxyError(res, error, "Could not remove event attendee.");
  }
});

router.post("/admin/attendance/confirm", requireAdmin, async (req, res) => {
  try {
    const result = await automation.confirmAdminEventAttendance({
      steamId: req.body?.steamId,
      eventId: req.body?.eventId,
      confirmedBySteamId: actorSteamId(req),
    });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) {
    return proxyError(res, error, "Could not confirm event attendance.");
  }
});

router.post("/admin/attendance/confirm-all", requireAdmin, async (req, res) => {
  try {
    return res.json(await automation.confirmAllAdminEventAttendance({
      eventId: req.body?.eventId,
      confirmedBySteamId: actorSteamId(req),
    }));
  } catch (error) {
    return proxyError(res, error, "Could not confirm all event attendance.");
  }
});

router.post("/admin/bonus", requireAdmin, async (req, res) => {
  try {
    const result = await automation.awardAdminEventBonus({
      steamId: req.body?.steamId,
      eventId: req.body?.eventId,
      eventTitle: req.body?.eventTitle,
      amount: req.body?.amount,
      label: req.body?.label,
      bonusId: req.body?.bonusId,
      applySupporterMultiplier: req.body?.applySupporterMultiplier === true,
      awardedBySteamId: actorSteamId(req),
    });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) {
    return proxyError(res, error, "Could not issue event bonus.");
  }
});

// Legacy manual reward endpoint retained as an admin fallback.
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
    return proxyError(res, error, "Could not issue event reward.");
  }
});

module.exports = router;
