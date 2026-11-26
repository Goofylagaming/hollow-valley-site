"use strict";

const { createHash } = require("node:crypto");

function alias(steamId) {
  const n = createHash("sha256").update("hv-arcade-alias:" + String(steamId)).digest().readUInt16BE(0) % 10000;
  return "Survivor #" + String(n).padStart(4, "0");
}

function publicName(username, steamId) {
  const name = String(username || "").replace(/\s+/g, " ").trim();
  const id = String(steamId || "");
  if (!name || /^survivor\d+$/i.test(name) || /\d{17}/.test(name) || (id && name.includes(id))) return alias(id);
  return name.slice(0, 64);
}

function present(raw, namesBySteamId) {
  const names = namesBySteamId || new Map();
  if (!raw || !Array.isArray(raw.entries) || !raw.you || !/^\d{17}$/.test(String(raw.you.steamId || ""))) {
    throw new Error("Invalid leaderboard");
  }
  const nameFor = steamId => publicName(names.get(steamId), steamId);
  const entries = raw.entries.slice(0, 10).map(row => ({
    rank: row.rank,
    name: nameFor(row.steamId),
    score: row.score
  }));
  const payload = {
    weekStart: raw.weekStart,
    weekEnd: raw.weekEnd,
    resetAt: raw.resetAt,
    entries,
    you: { rank: raw.you.rank, name: nameFor(raw.you.steamId), score: raw.you.score }
  };
  const encoded = JSON.stringify(payload);
  const ids = [raw.you.steamId, ...raw.entries.map(row => row.steamId)];
  if (/\d{17}/.test(encoded) || ids.some(id => id && encoded.includes(String(id)))) {
    throw new Error("Invalid leaderboard");
  }
  return payload;
}

function recentType(value) {
  const text = String(value || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (!/^[a-z][a-z0-9-]{0,24}$/.test(text)) return "";
  return text;
}

function recentLabel(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text || text.length > max || /\d{17}/.test(text) || /\b(?:vc|valley\s+coins?)\b/i.test(text)) return "";
  return text;
}

function recentTime(value) {
  if (typeof value !== "string" || !value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

// Automation rows are { steamId, type, name, rarity, timestamp }.
// name is the reward. steamId is replaced with the weekly-board display name.
function presentRecent(raw, namesBySteamId) {
  if (!raw || !Array.isArray(raw.entries)) throw new Error("Invalid recent wins");
  const names = namesBySteamId || new Map();
  const nameFor = steamId => publicName(names.get(steamId), steamId);
  const seenIds = [];
  const entries = [];
  for (const row of raw.entries.slice(0, 10)) {
    if (!row || typeof row !== "object") continue;
    const steamId = String(row.steamId || "");
    if (!/^\d{17}$/.test(steamId)) continue;
    seenIds.push(steamId);
    const item = recentLabel(row.name, 80);
    const rarity = recentLabel(row.rarity, 32);
    const timestamp = recentTime(row.timestamp);
    if (!item || !rarity || !timestamp) continue;
    entries.push({
      player: nameFor(steamId),
      type: recentType(row.type),
      name: item,
      rarity,
      timestamp
    });
  }
  const payload = { entries };
  const encoded = JSON.stringify(payload);
  if (/\d{17}/.test(encoded) || seenIds.some(id => encoded.includes(id)) || /"steamId"/.test(encoded)) {
    throw new Error("Invalid recent wins");
  }
  return payload;
}

module.exports = { alias, publicName, present, presentRecent };
