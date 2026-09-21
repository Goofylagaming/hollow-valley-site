const express = require("express");
const { getLeaderboards } = require("../db");
const automation = require("../services/automationWebsiteClient");

const router = express.Router();

router.get("/", async (_req, res) => {
  const legacy = getLeaderboards();
  try {
    const playtime = await automation.getPlaytimeLeaderboard({ hours: 24 * 31 });
    return res.json({
      mostKills: Array.isArray(legacy.mostKills) ? legacy.mostKills : [],
      bestKd: Array.isArray(legacy.bestKd) ? legacy.bestKd : [],
      mostPlaytime: Array.isArray(playtime.players) ? playtime.players : [],
      playtimeWindowHours: Number(playtime.windowHours || 24 * 31),
      playtimeTrackingEnabled: playtime.trackingEnabled !== false,
      playtimeWindowStart: playtime.windowStart || null,
      playtimeWindowEnd: playtime.windowEnd || null,
    });
  } catch (error) {
    console.warn("[leaderboards] playtime automation unavailable:", error.message);
    return res.json({
      mostKills: Array.isArray(legacy.mostKills) ? legacy.mostKills : [],
      bestKd: Array.isArray(legacy.bestKd) ? legacy.bestKd : [],
      mostPlaytime: Array.isArray(legacy.mostPlaytime) ? legacy.mostPlaytime : [],
      playtimeWindowHours: 24 * 31,
      playtimeTrackingEnabled: false,
      playtimeWindowStart: null,
      playtimeWindowEnd: null,
    });
  }
});

module.exports = router;
