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

module.exports = { alias, publicName, present };
