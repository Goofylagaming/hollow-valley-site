const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const questChallenges = require('./questBoostService');

const dbPath = process.env.AUTOMATION_DB_PATH || path.join(__dirname, '..', '..', 'data', 'automation.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const COMBAT_LOCATION_MAX_SKEW_MS = 45 * 1000;

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA journal_mode = WAL;');
db.exec(`
  CREATE TABLE IF NOT EXISTS combat_events (
    id TEXT PRIMARY KEY,
    occurred_at TEXT NOT NULL,
    killer_steam_id TEXT,
    killer_name TEXT,
    victim_steam_id TEXT NOT NULL,
    victim_name TEXT,
    source TEXT NOT NULL,
    killer_location_json TEXT,
    victim_location_json TEXT,
    presence_sampled_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_combat_events_occurred
    ON combat_events(occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_combat_events_killer
    ON combat_events(killer_steam_id, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_combat_events_victim
    ON combat_events(victim_steam_id, occurred_at DESC);

  CREATE TABLE IF NOT EXISTS combat_players (
    steam_id TEXT PRIMARY KEY,
    display_name TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

function ensureCombatColumn(name, sql) {
  const columns = db.prepare('PRAGMA table_info(combat_events)').all();
  if (columns.some((column) => column.name === name)) return;
  db.exec(`ALTER TABLE combat_events ADD COLUMN ${sql}`);
}

ensureCombatColumn('killer_location_json', 'killer_location_json TEXT');
ensureCombatColumn('victim_location_json', 'victim_location_json TEXT');
ensureCombatColumn('presence_sampled_at', 'presence_sampled_at TEXT');

function enabled(env = process.env) {
  return String(env.COMBAT_FEED_ENABLED || '').toLowerCase() === 'true';
}

function configured(env = process.env) {
  return Boolean(String(env.COMBAT_FEED_TOKEN || '').trim());
}

function sourceName(env = process.env) {
  const value = String(env.COMBAT_FEED_SOURCE || 'hollow-valley-game').trim();
  return /^[A-Za-z0-9_.:-]{2,80}$/.test(value) ? value : 'hollow-valley-game';
}

function state(env = process.env) {
  return {
    enabled: enabled(env),
    configured: configured(env),
    source: sourceName(env),
    locationMaxSkewSeconds: COMBAT_LOCATION_MAX_SKEW_MS / 1000,
  };
}

function feedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validateSteamId(value, { optional = false } = {}) {
  const steamId = String(value || '').trim();
  if (optional && !steamId) return null;
  if (!/^\d{17}$/.test(steamId)) throw feedError('COMBAT_EVENT_INVALID', 'Combat event Steam IDs must be 17 digits.');
  return steamId;
}

function validateEventId(value) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9:_-]{8,160}$/.test(id)) {
    throw feedError('COMBAT_EVENT_INVALID', 'Combat event ID is missing or invalid.');
  }
  return id;
}

function cleanName(value) {
  const name = String(value || '').replace(/[\x00-\x1f\x7f]/g, '').trim().replace(/\s+/g, ' ');
  return name ? name.slice(0, 80) : null;
}

function validateOccurredAt(value) {
  const time = new Date(value);
  if (!Number.isFinite(time.getTime())) {
    throw feedError('COMBAT_EVENT_INVALID', 'Combat event occurredAt must be a valid timestamp.');
  }
  if (time.getTime() > Date.now() + 5 * 60 * 1000) {
    throw feedError('COMBAT_EVENT_INVALID', 'Combat event occurredAt is too far in the future.');
  }
  return time.toISOString();
}

function normalizeEvent(input = {}, env = process.env) {
  const victimSteamId = validateSteamId(input.victimSteamId);
  const killerSteamId = validateSteamId(input.killerSteamId, { optional: true });
  return {
    id: validateEventId(input.eventId || input.id),
    occurredAt: validateOccurredAt(input.occurredAt),
    killerSteamId,
    killerName: killerSteamId ? cleanName(input.killerName) : null,
    victimSteamId,
    victimName: cleanName(input.victimName),
    source: sourceName(env),
  };
}

function getEvent(id) {
  return db.prepare('SELECT * FROM combat_events WHERE id = ?').get(String(id)) || null;
}

function sameEvent(row, event) {
  return Boolean(row) &&
    row.occurred_at === event.occurredAt &&
    (row.killer_steam_id || null) === event.killerSteamId &&
    (row.killer_name || null) === event.killerName &&
    row.victim_steam_id === event.victimSteamId &&
    (row.victim_name || null) === event.victimName &&
    row.source === event.source;
}

function upsertPlayer(steamId, displayName) {
  if (!steamId || !displayName) return;
  db.prepare(`
    INSERT INTO combat_players (steam_id, display_name, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(steam_id) DO UPDATE SET
      display_name = excluded.display_name,
      updated_at = datetime('now')
  `).run(steamId, displayName);
}

function trackQuestChallenges(row) {
  if (!row) return { skipped: true, duplicate: false, completed: [] };
  try {
    return questChallenges.recordCombatEvent({
      id: row.id,
      occurredAt: row.occurred_at,
      killerSteamId: row.killer_steam_id,
      victimSteamId: row.victim_steam_id,
    });
  } catch (error) {
    console.warn('[quest-combat]', error.message);
    return { skipped: true, duplicate: false, completed: [], error: error.message };
  }
}

function parseSnapshotLocation(value) {
  if (!value || typeof value !== 'object') return null;
  const x = Number(value.x ?? value.X);
  const y = Number(value.y ?? value.Y);
  const z = Number(value.z ?? value.Z);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y, z: Number.isFinite(z) ? z : null };
}

function latestPresenceSnapshot() {
  const table = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name = 'external_server_snapshot'
  `).get();
  if (!table) return null;

  const row = db.prepare(`
    SELECT sampled_at, snapshot_json
    FROM external_server_snapshot
    WHERE id = 1
  `).get();
  if (!row) return null;

  let snapshot;
  try { snapshot = JSON.parse(row.snapshot_json); } catch { return null; }
  return { sampledAt: row.sampled_at, snapshot };
}

function locationContextForEvent(event) {
  const current = latestPresenceSnapshot();
  if (!current) return { sampledAt: null, killerLocation: null, victimLocation: null };

  const sampledAtMs = Date.parse(current.sampledAt);
  const occurredAtMs = Date.parse(event.occurredAt);
  if (!Number.isFinite(sampledAtMs) || !Number.isFinite(occurredAtMs)) {
    return { sampledAt: null, killerLocation: null, victimLocation: null };
  }

  const skewMs = Math.abs(sampledAtMs - occurredAtMs);
  if (skewMs > COMBAT_LOCATION_MAX_SKEW_MS) {
    return { sampledAt: null, killerLocation: null, victimLocation: null };
  }

  const characters = new Map(
    (Array.isArray(current.snapshot?.characters) ? current.snapshot.characters : [])
      .map((character) => [String(character?.steamId || ''), character])
  );
  const killerLocation = event.killerSteamId
    ? parseSnapshotLocation(characters.get(event.killerSteamId)?.location)
    : null;
  const victimLocation = parseSnapshotLocation(characters.get(event.victimSteamId)?.location);

  return {
    sampledAt: new Date(sampledAtMs).toISOString(),
    killerLocation,
    victimLocation,
  };
}

function serializeLocation(value) {
  return value ? JSON.stringify(value) : null;
}

function parseStoredLocation(value) {
  if (!value) return null;
  try { return parseSnapshotLocation(JSON.parse(value)); } catch { return null; }
}

function ingestEvent(input, { env = process.env } = {}) {
  if (!enabled(env)) throw feedError('COMBAT_FEED_DISABLED', 'Authoritative combat ingestion is disabled.');

  const event = normalizeEvent(input, env);
  const existing = getEvent(event.id);
  if (existing) {
    if (!sameEvent(existing, event)) {
      throw feedError('COMBAT_EVENT_CONFLICT', 'Combat event ID already exists with different event data.');
    }
    return { duplicate: true, event: existing, questChallenges: trackQuestChallenges(existing) };
  }

  const locationContext = locationContextForEvent(event);

  db.exec('BEGIN IMMEDIATE');
  try {
    const raced = getEvent(event.id);
    if (raced) {
      if (!sameEvent(raced, event)) throw feedError('COMBAT_EVENT_CONFLICT', 'Combat event ID already exists with different event data.');
      db.exec('COMMIT');
      return { duplicate: true, event: raced, questChallenges: trackQuestChallenges(raced) };
    }

    db.prepare(`
      INSERT INTO combat_events
        (id, occurred_at, killer_steam_id, killer_name, victim_steam_id, victim_name, source,
         killer_location_json, victim_location_json, presence_sampled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.occurredAt,
      event.killerSteamId,
      event.killerName,
      event.victimSteamId,
      event.victimName,
      event.source,
      serializeLocation(locationContext.killerLocation),
      serializeLocation(locationContext.victimLocation),
      locationContext.sampledAt
    );

    upsertPlayer(event.victimSteamId, event.victimName);
    if (event.killerSteamId && event.killerSteamId !== event.victimSteamId) {
      upsertPlayer(event.killerSteamId, event.killerName);
    }

    db.exec('COMMIT');
    const saved = getEvent(event.id);
    return { duplicate: false, event: saved, questChallenges: trackQuestChallenges(saved) };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

function listEvents({ since = null, limit = 100, nowMs = Date.now() } = {}) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const fallbackSince = new Date(Number(nowMs) - 24 * 60 * 60 * 1000).toISOString();
  const sinceDate = since ? new Date(since) : new Date(fallbackSince);
  const sinceIso = Number.isFinite(sinceDate.getTime()) ? sinceDate.toISOString() : fallbackSince;

  return db.prepare(`
    SELECT id, occurred_at, killer_steam_id, killer_name, victim_steam_id, victim_name, source,
           killer_location_json, victim_location_json, presence_sampled_at
    FROM combat_events
    WHERE occurred_at >= ?
    ORDER BY occurred_at ASC, id ASC
    LIMIT ?
  `).all(sinceIso, safeLimit).map((row) => ({
    id: row.id,
    occurredAt: row.occurred_at,
    killerSteamId: row.killer_steam_id || null,
    killerName: row.killer_name || null,
    victimSteamId: row.victim_steam_id,
    victimName: row.victim_name || null,
    source: row.source,
    killerLocation: parseStoredLocation(row.killer_location_json),
    victimLocation: parseStoredLocation(row.victim_location_json),
    presenceSampledAt: row.presence_sampled_at || null,
  }));
}

function leaderboard({ hours = 24 * 31, limit = 100, nowMs = Date.now() } = {}) {
  const safeHours = Math.max(1, Math.min(24 * 31, Number(hours) || 24 * 31));
  const safeLimit = Math.max(1, Math.min(250, Number(limit) || 100));
  const since = new Date(nowMs - safeHours * 60 * 60 * 1000).toISOString();

  const rows = db.prepare(`
    WITH
      kills AS (
        SELECT killer_steam_id AS steam_id, COUNT(*) AS kills
        FROM combat_events
        WHERE occurred_at >= ?
          AND killer_steam_id IS NOT NULL
          AND killer_steam_id <> victim_steam_id
        GROUP BY killer_steam_id
      ),
      deaths AS (
        SELECT victim_steam_id AS steam_id, COUNT(*) AS deaths
        FROM combat_events
        WHERE occurred_at >= ?
        GROUP BY victim_steam_id
      ),
      ids AS (
        SELECT steam_id FROM kills
        UNION
        SELECT steam_id FROM deaths
      )
    SELECT
      ids.steam_id,
      COALESCE(combat_players.display_name, 'Unknown') AS username,
      COALESCE(kills.kills, 0) AS kills,
      COALESCE(deaths.deaths, 0) AS deaths
    FROM ids
    LEFT JOIN kills ON kills.steam_id = ids.steam_id
    LEFT JOIN deaths ON deaths.steam_id = ids.steam_id
    LEFT JOIN combat_players ON combat_players.steam_id = ids.steam_id
  `).all(since, since).map((row) => {
    const kills = Number(row.kills) || 0;
    const deaths = Number(row.deaths) || 0;
    return {
      steamId: row.steam_id,
      username: row.username || 'Unknown',
      kills,
      deaths,
      kd: deaths > 0 ? Math.round((kills / deaths) * 100) / 100 : kills,
    };
  });

  const mostKills = rows
    .filter((row) => row.kills > 0)
    .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.username.localeCompare(b.username))
    .slice(0, safeLimit);

  const bestKd = rows
    .filter((row) => row.kills > 0)
    .sort((a, b) => b.kd - a.kd || b.kills - a.kills || a.deaths - b.deaths || a.username.localeCompare(b.username))
    .slice(0, safeLimit);

  const summary = db.prepare(`
    SELECT COUNT(*) AS event_count, MAX(occurred_at) AS latest_event_at
    FROM combat_events
    WHERE occurred_at >= ?
  `).get(since);

  return {
    ...state(),
    windowHours: safeHours,
    windowStart: since,
    windowEnd: new Date(nowMs).toISOString(),
    eventCount: Number(summary?.event_count) || 0,
    latestEventAt: summary?.latest_event_at || null,
    mostKills,
    bestKd,
  };
}

module.exports = {
  enabled,
  configured,
  sourceName,
  state,
  normalizeEvent,
  ingestEvent,
  listEvents,
  leaderboard,
  _test: {
    db,
    getEvent,
    latestPresenceSnapshot,
    locationContextForEvent,
    COMBAT_LOCATION_MAX_SKEW_MS,
  },
};
