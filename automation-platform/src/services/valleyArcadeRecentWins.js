"use strict";

// Read-only highlights from crates that were already opened.
// steamId is for the website name lookup only and must not be sent to browsers.
// Coin amounts, odds, XP and wager fields are never copied out of stored rows.

const arcade = require("./valleyArcade");
const { db, getSkinPreset } = require("./economyStore");
const CACHE_MS = 30000;
const PAGE = 40;
const RARE_OR_BETTER = new Set(["Rare", "Epic", "Legendary"]);
let cache = null;

function tableReady() {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='arcade_crates'").get());
}

function parseJson(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function publicName(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text || text.length > 80) return null;
  if (/^\d{17}$/.test(text)) return null;
  if (/@/.test(text)) return null;
  if (/\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(text)) return null;
  if (/\b(?:vc|valley\s*coins?|coins?|payouts?|odds|wagers?|xp)\b/i.test(text)) return null;
  if (/[$€£]/.test(text)) return null;
  return text;
}

function titleSpecies(species) {
  const text = String(species || "").trim().replace(/[-_]+/g, " ");
  if (!/^[A-Za-z][A-Za-z0-9 ]{0,40}$/.test(text)) return null;
  return text.replace(/\b[a-z]/g, letter => letter.toUpperCase());
}

// Rarity is the drop's stored weight against the crate's stored table.
// Rare or better means that share is 10% or less. This does not change odds.
function rarityFor(weight, total) {
  if (!Number.isSafeInteger(weight) || !Number.isSafeInteger(total) || weight <= 0 || total <= 0 || weight > total) return null;
  if (weight * 100 <= total) return "Legendary";
  if (weight * 100 <= total * 3) return "Epic";
  if (weight * 10 <= total) return "Rare";
  return null;
}

function poolTotal(pool) {
  if (!Array.isArray(pool)) return 0;
  return pool.reduce((sum, row) => {
    const weight = row && row.weight;
    return Number.isSafeInteger(weight) && weight > 0 ? sum + weight : sum;
  }, 0);
}

function skinName(reward) {
  const presetId = typeof reward.presetId === "string" ? reward.presetId.trim() : "";
  if (/^[A-Za-z0-9_-]{1,80}$/.test(presetId)) {
    const named = publicName(getSkinPreset(presetId)?.name);
    if (named) return named;
  }
  return publicName(reward.label);
}

function dinoName(reward) {
  const named = publicName(reward.label);
  if (named) return named;
  const species = titleSpecies(reward.species);
  const growth = reward.growthPercent;
  if (species && Number.isSafeInteger(growth) && growth >= 1 && growth <= 100) return publicName(growth + "% " + species);
  return species ? publicName(species) : null;
}

function present(row) {
  const reward = parseJson(row.rewardJson);
  const pool = parseJson(row.rewardsJson);
  if (!reward || (reward.type !== "skin" && reward.type !== "dinosaur")) return null;
  const rarity = rarityFor(reward.weight, poolTotal(pool));
  if (!RARE_OR_BETTER.has(rarity)) return null;
  const steamId = String(row.steamId || "");
  if (!/^\d{17}$/.test(steamId)) return null;
  const name = reward.type === "skin" ? skinName(reward) : dinoName(reward);
  const openedAt = Number(row.openedAt);
  if (!name || !Number.isSafeInteger(openedAt) || openedAt <= 0) return null;
  return { steamId, type: "crate", name, rarity, timestamp: new Date(openedAt).toISOString() };
}

function loadPage(offset) {
  return db.prepare(`SELECT id, steam_id AS steamId, opened_at AS openedAt,
      reward_json AS rewardJson, rewards_json AS rewardsJson
    FROM arcade_crates
    WHERE opened_at IS NOT NULL
      AND reward_json IS NOT NULL
      AND json_valid(reward_json)
      AND json_extract(reward_json, '$.type') IN ('skin', 'dinosaur')
    ORDER BY opened_at DESC, id DESC
    LIMIT ? OFFSET ?`).all(PAGE, offset);
}

function collect() {
  if (!tableReady()) return [];
  const entries = [];
  for (let offset = 0; entries.length < 10; offset += PAGE) {
    const rows = loadPage(offset);
    if (!rows.length) break;
    for (const row of rows) {
      const entry = present(row);
      if (!entry) continue;
      entries.push(entry);
      if (entries.length === 10) break;
    }
    if (rows.length < PAGE) break;
  }
  return entries;
}

function recent(now = Date.now()) {
  if (process.env.VALLEY_ARCADE_ENABLED !== "1") throw new Error("Arcade disabled");
  const settings = arcade.settings();
  if (!settings.enabled || settings.emergency) throw new Error("Arcade disabled");
  if (!cache || now - cache.at >= CACHE_MS || now < cache.at) cache = { at: now, entries: collect() };
  return { entries: cache.entries };
}

function resetCache() { cache = null; }

module.exports = { recent, resetCache, CACHE_MS, rarityFor };
