const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dbPath = process.env.AUTOMATION_DB_PATH || path.join(__dirname, '..', '..', 'data', 'automation.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA journal_mode = WAL;');
db.exec(`
  CREATE TABLE IF NOT EXISTS external_server_snapshot (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    sample_id TEXT NOT NULL,
    sampled_at TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

function maxAgeMs() {
  const seconds = Number(process.env.PRESENCE_FEED_MAX_AGE_SECONDS || 180);
  const safeSeconds = Math.max(60, Math.min(600, Number.isFinite(seconds) ? seconds : 180));
  return safeSeconds * 1000;
}

function saveSnapshot({ sampleId, sampledAt, players = [], maxPlayers = null }) {
  const snapshot = {
    online: true,
    players: players.map((player) => ({
      steamId: player.steamId,
      name: player.name,
    })),
    characters: players.map((player) => ({
      steamId: player.steamId,
      name: player.name,
      gender: player.gender ?? null,
      species: player.species ?? null,
      growth: Number.isFinite(player.growth) ? player.growth : null,
      health: Number.isFinite(player.health) ? player.health : null,
      stamina: Number.isFinite(player.stamina) ? player.stamina : null,
      hunger: Number.isFinite(player.hunger) ? player.hunger : null,
      thirst: Number.isFinite(player.thirst) ? player.thirst : null,
      isPrime: player.isPrime === true,
      mutations: Array.isArray(player.mutations) ? player.mutations : [],
      location: player.location || null,
    })),
    maxPlayers: Number.isFinite(Number(maxPlayers))
      ? Number(maxPlayers)
      : (Number(process.env.MAX_PLAYERS || 0) || null),
  };

  db.prepare(`
    INSERT INTO external_server_snapshot
      (id, sample_id, sampled_at, snapshot_json, updated_at)
    VALUES (1, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      sample_id = excluded.sample_id,
      sampled_at = excluded.sampled_at,
      snapshot_json = excluded.snapshot_json,
      updated_at = datetime('now')
  `).run(sampleId, sampledAt, JSON.stringify(snapshot));

  return snapshot;
}

function readLatest({ nowMs = Date.now(), allowStale = false } = {}) {
  const row = db.prepare(`
    SELECT sample_id, sampled_at, snapshot_json
    FROM external_server_snapshot
    WHERE id = 1
  `).get();
  if (!row) return null;

  const sampledAtMs = Date.parse(row.sampled_at);
  if (!Number.isFinite(sampledAtMs)) return null;
  const ageMs = Math.max(0, Number(nowMs) - sampledAtMs);
  const stale = ageMs > maxAgeMs();
  if (stale && !allowStale) return null;

  let snapshot;
  try {
    snapshot = JSON.parse(row.snapshot_json);
  } catch {
    return null;
  }

  return {
    ...snapshot,
    sampleId: row.sample_id,
    checkedAt: row.sampled_at,
    configured: true,
    cached: true,
    source: 'external-presence',
    stale,
    ageMs,
    error: stale ? 'External presence snapshot is stale' : null,
  };
}

module.exports = {
  saveSnapshot,
  readLatest,
  maxAgeMs,
};
