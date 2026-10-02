const express = require("express");
const automation = require("../services/automationWebsiteClient");

const router = express.Router();

router.get("/", async (_req, res) => {
  const response = {
    dailyKills: [],
    dailyKd: [],
    dailyDeaths: [],
    weeklyKills: [],
    weeklyKd: [],
    weeklyDeaths: [],
    mostPlaytime: [],
    mostLevels: [],
    combatFeedEnabled: false,
    combatFeedConfigured: false,
    combatEventCount: 0,
    combatLatestEventAt: null,
    dailyCombatWindowStart: null,
    dailyCombatWindowEnd: null,
    weeklyCombatWindowStart: null,
    weeklyCombatWindowEnd: null,
    dailyKdMinKills: 3,
    weeklyKdMinKills: 10,
    playtimeWindowHours: 24 * 31,
    playtimeTrackingEnabled: false,
    playtimeWindowStart: null,
    playtimeWindowEnd: null,
  };

  try {
    const [daily, weekly] = await Promise.all([
      automation.getCombatLeaderboard({ hours: 24 }),
      automation.getCombatLeaderboard({ hours: 24 * 7 }),
    ]);

    response.dailyKills = Array.isArray(daily.mostKills) ? daily.mostKills : [];
    response.dailyKd = Array.isArray(daily.bestKd) ? daily.bestKd : [];
    response.dailyDeaths = Array.isArray(daily.mostDeaths) ? daily.mostDeaths : [];
    response.weeklyKills = Array.isArray(weekly.mostKills) ? weekly.mostKills : [];
    response.weeklyKd = Array.isArray(weekly.bestKd) ? weekly.bestKd : [];
    response.weeklyDeaths = Array.isArray(weekly.mostDeaths) ? weekly.mostDeaths : [];
    response.combatFeedEnabled = daily.enabled === true || weekly.enabled === true;
    response.combatFeedConfigured = daily.configured === true || weekly.configured === true;
    response.combatEventCount = Number(daily.eventCount || 0) + Number(weekly.eventCount || 0);
    response.combatLatestEventAt = [daily.latestEventAt, weekly.latestEventAt].filter(Boolean).sort().at(-1) || null;
    response.dailyCombatWindowStart = daily.windowStart || null;
    response.dailyCombatWindowEnd = daily.windowEnd || null;
    response.weeklyCombatWindowStart = weekly.windowStart || null;
    response.weeklyCombatWindowEnd = weekly.windowEnd || null;
    response.dailyKdMinKills = Number(daily.minimumKdKills || 3);
    response.weeklyKdMinKills = Number(weekly.minimumKdKills || 10);
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

  try {
    const levels = await automation.getProgressionLeaderboard();
    response.mostLevels = Array.isArray(levels.players) ? levels.players : [];
  } catch (error) {
    console.warn("[leaderboards] permanent progression unavailable:", error.message);
  }

  res.json(response);
});

module.exports = router;
