const express = require("express");
const automation = require("../services/automationWebsiteClient");

const router = express.Router();

router.get("/", async (_req, res) => {
  const response = {
    mostKills: [],
    bestKd: [],
    mostPlaytime: [],
    combatFeedEnabled: false,
    combatFeedConfigured: false,
    combatEventCount: 0,
    combatLatestEventAt: null,
    combatWindowHours: 24 * 31,
    playtimeWindowHours: 24 * 31,
    playtimeTrackingEnabled: false,
    playtimeWindowStart: null,
    playtimeWindowEnd: null,
  };

  try {
    const combat = await automation.getCombatLeaderboard({ hours: 24 * 31 });
    response.mostKills = Array.isArray(combat.mostKills) ? combat.mostKills : [];
    response.bestKd = Array.isArray(combat.bestKd) ? combat.bestKd : [];
    response.combatFeedEnabled = combat.enabled === true;
    response.combatFeedConfigured = combat.configured === true;
    response.combatEventCount = Number(combat.eventCount || 0);
    response.combatLatestEventAt = combat.latestEventAt || null;
    response.combatWindowHours = Number(combat.windowHours || 24 * 31);
  } catch (error) {
    console.warn("[leaderboards] verified combat automation unavailable:", error.message);
  }

  try {
    const playtime = await automation.getPlaytimeLeaderboard({ hours: 24 * 31 });
    response.mostPlaytime = Array.isArray(playtime.players) ? playtime.players : [];
    response.playtimeWindowHours = Number(playtime.windowHours || 24 * 31);
    response.playtimeTrackingEnabled = playtime.trackingEnabled !== false;
    response.playtimeWindowStart = playtime.windowStart || null;
    response.playtimeWindowEnd = playtime.windowEnd || null;
  } catch (error) {
    console.warn("[leaderboards] verified playtime automation unavailable:", error.message);
  }

  res.json(response);
});

module.exports = router;
