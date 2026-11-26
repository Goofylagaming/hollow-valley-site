"use strict";

const arcade = require("./valleyArcade");
const rewards = require("./arcadeRewards");
const { db, validateSteamId } = require("./economyStore");
const BRISBANE_SHIFT_MS = 10 * 60 * 60 * 1000;
const CACHE_MS = 30000;
let cache = null;

function weekRange(now) {
  const shifted = new Date(now + BRISBANE_SHIFT_MS);
  const daysSinceMonday = (shifted.getUTCDay() + 6) % 7;
  const mondayUtc = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - daysSinceMonday * 86400000;
  return {
    start: new Date(mondayUtc).toISOString().slice(0, 10),
    end: new Date(mondayUtc + 6 * 86400000).toISOString().slice(0, 10),
    resetAt: mondayUtc + 7 * 86400000 - BRISBANE_SHIFT_MS
  };
}

function dailyCap() {
  const configured = Number(rewards.config().dailyPlays);
  return Number.isInteger(configured) && configured > 0 ? configured : 6;
}

function collect(start, end, cap) {
  const rows = db.prepare(`SELECT steam_id AS steamId, settled_day AS day, SUM(score) AS correct, MIN(opened_at) AS firstAt
    FROM arcade_rounds
    WHERE score > 0 AND settled_day >= ? AND settled_day <= ?
    GROUP BY steam_id, settled_day`).all(start, end);
  const byPlayer = new Map();
  for (const row of rows) {
    const gained = Math.min(Number(row.correct) || 0, cap);
    const current = byPlayer.get(row.steamId) || { steamId: row.steamId, score: 0, firstAt: row.firstAt };
    current.score += gained;
    if (row.firstAt < current.firstAt) current.firstAt = row.firstAt;
    byPlayer.set(row.steamId, current);
  }
  return [...byPlayer.values()]
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score || a.firstAt - b.firstAt || (a.steamId < b.steamId ? -1 : 1));
}

// Internal payload. steamId is for the website name lookup only and must not be sent to browsers.
function weekly(steamId, now = Date.now()) {
  steamId = validateSteamId(steamId);
  if (process.env.VALLEY_ARCADE_ENABLED !== "1") throw new Error("Arcade disabled");
  const settings = arcade.settings();
  if (!settings.enabled || settings.emergency) throw new Error("Arcade disabled");
  const week = weekRange(now);
  const cap = dailyCap();
  if (!cache || cache.key !== week.start || cache.cap !== cap || now - cache.at >= CACHE_MS || now < cache.at) {
    cache = { key: week.start, at: now, cap, rows: collect(week.start, week.end, cap) };
  }
  const rows = cache.rows;
  const index = rows.findIndex(row => row.steamId === steamId);
  return {
    weekStart: week.start,
    weekEnd: week.end,
    resetAt: week.resetAt,
    entries: rows.slice(0, 10).map((row, position) => ({ rank: position + 1, steamId: row.steamId, score: row.score })),
    you: index === -1 ? { rank: null, steamId, score: 0 } : { rank: index + 1, steamId, score: rows[index].score }
  };
}

function resetCache() { cache = null; }

module.exports = { weekly, weekRange, resetCache, CACHE_MS };
