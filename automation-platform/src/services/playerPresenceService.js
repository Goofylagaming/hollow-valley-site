const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { getServerSnapshot } = require('./statusService');

const dbPath = process.env.AUTOMATION_DB_PATH || path.join(__dirname, '..', '..', 'data', 'automation.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec(`
  CREATE TABLE IF NOT EXISTS player_presence_sessions (
    id TEXT PRIMARY KEY,
    steam_id TEXT NOT NULL,
    player_name TEXT,
    species TEXT,
    started_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    ended_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_presence_open
    ON player_presence_sessions(ended_at, last_seen_at DESC);
  CREATE INDEX IF NOT EXISTS idx_presence_steam
    ON player_presence_sessions(steam_id, started_at DESC);
`);

let running = false;

function enabled() {
  return String(process.env.PLAYER_PRESENCE_ENABLED || '').toLowerCase() === 'true';
}

function intervalMs() {
  const value = Number(process.env.PLAYER_PRESENCE_INTERVAL_MS || 60000);
  return Math.max(15000, Math.min(600000, Number.isFinite(value) ? value : 60000));
}

function normalizeOnline(snapshot) {
  const characters = new Map((snapshot.characters || []).map((item) => [String(item.steamId), item]));
  return (snapshot.players || []).map((player) => {
    const steamId = String(player.steamId || '');
    const character = characters.get(steamId);
    return {
      steamId,
      name: player.name || character?.name || 'Unknown',
      species: character?.species || null,
    };
  }).filter((player) => /^\d{17}$/.test(player.steamId));
}

function reconcilePresence(onlinePlayers, nowIso = new Date().toISOString()) {
  const onlineBySteam = new Map(onlinePlayers.map((player) => [player.steamId, player]));
  const open = db.prepare(`
    SELECT * FROM player_presence_sessions
    WHERE ended_at IS NULL
    ORDER BY started_at ASC
  `).all();
  const openBySteam = new Map(open.map((row) => [row.steam_id, row]));
  let opened = 0;
  let updated = 0;
  let closed = 0;

  const insert = db.prepare(`
    INSERT INTO player_presence_sessions
      (id, steam_id, player_name, species, started_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const touch = db.prepare(`
    UPDATE player_presence_sessions
    SET player_name = ?, species = ?, last_seen_at = ?, updated_at = datetime('now')
    WHERE id = ?
  `);
  const close = db.prepare(`
    UPDATE player_presence_sessions
    SET ended_at = ?, updated_at = datetime('now')
    WHERE id = ? AND ended_at IS NULL
  `);

  for (const player of onlinePlayers) {
    const existing = openBySteam.get(player.steamId);
    if (existing) {
      touch.run(player.name, player.species, nowIso, existing.id);
      updated += 1;
    } else {
      insert.run(randomUUID(), player.steamId, player.name, player.species, nowIso, nowIso);
      opened += 1;
    }
  }

  for (const row of open) {
    if (onlineBySteam.has(row.steam_id)) continue;
    closed += close.run(nowIso, row.id).changes;
  }

  return { opened, updated, closed, online: onlinePlayers.length };
}

async function samplePresence({ force = false } = {}) {
  if (running) return { skipped: true, reason: 'sample-already-running' };
  if (!enabled()) return { skipped: true, reason: 'disabled' };
  running = true;
  try {
    const snapshot = await getServerSnapshot({ force });
    if (!snapshot.configured) return { skipped: true, reason: 'rcon-not-configured' };
    if (!snapshot.online) {
      return {
        skipped: true,
        reason: 'rcon-unavailable',
        error: snapshot.error || null,
      };
    }
    const players = normalizeOnline(snapshot);
    return { skipped: false, ...reconcilePresence(players) };
  } finally {
    running = false;
  }
}

function listSessions({ steamId = null, activeOnly = false, limit = 100 } = {}) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const clauses = [];
  const params = [];
  if (steamId) {
    const id = String(steamId);
    if (!/^\d{17}$/.test(id)) throw new Error('Invalid Steam ID');
    clauses.push('steam_id = ?');
    params.push(id);
  }
  if (activeOnly) clauses.push('ended_at IS NULL');
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`
    SELECT id, steam_id, player_name, species, started_at, last_seen_at, ended_at
    FROM player_presence_sessions
    ${where}
    ORDER BY COALESCE(ended_at, last_seen_at) DESC
    LIMIT ?
  `).all(...params, safeLimit);
}

function getPresenceSummary() {
  const active = db.prepare('SELECT COUNT(*) AS count FROM player_presence_sessions WHERE ended_at IS NULL').get().count;
  const sessions24h = db.prepare(`
    SELECT COUNT(*) AS count FROM player_presence_sessions
    WHERE started_at >= datetime('now', '-24 hours')
  `).get().count;
  const unique24h = db.prepare(`
    SELECT COUNT(DISTINCT steam_id) AS count FROM player_presence_sessions
    WHERE started_at >= datetime('now', '-24 hours') OR last_seen_at >= datetime('now', '-24 hours')
  `).get().count;
  return { enabled: enabled(), active, sessions24h, uniquePlayers24h: unique24h };
}

function startPlayerPresence() {
  if (!enabled()) return null;
  samplePresence({ force: false }).catch((error) => console.warn('[player-presence]', error.message));
  const timer = setInterval(() => {
    samplePresence({ force: false }).catch((error) => console.warn('[player-presence]', error.message));
  }, intervalMs());
  timer.unref?.();
  return timer;
}

module.exports = {
  enabled,
  intervalMs,
  normalizeOnline,
  reconcilePresence,
  samplePresence,
  listSessions,
  getPresenceSummary,
  startPlayerPresence,
};
