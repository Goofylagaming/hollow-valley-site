const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const questChallenges = require('./questBoostService');

const dbPath = process.env.AUTOMATION_DB_PATH || path.join(__dirname, '..', '..', 'data', 'automation.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_combat_events_occurred
    ON combat_events(occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_combat_events_killer
    ON combat_events(killer_steam_id, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_combat_events_victim
    ON combat_events(victim_steam_id, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_combat_events_semantic
    ON combat_events(occurred_at, victim_steam_id, killer_steam_id, source);

  CREATE TABLE IF NOT EXISTS combat_players (
    steam_id TEXT PRIMARY KEY,
    display_name TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS combat_stat_resets (
    steam_id TEXT PRIMARY KEY,
    reset_at TEXT NOT NULL,
    reason TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const BRISBANE_OFFSET_MS = 10 * HOUR_MS;

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
  return { enabled: enabled(env), configured: configured(env), source: sourceName(env) };
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

function getSemanticEvent(event) {
  return db.prepare(`
    SELECT *
    FROM combat_events
    WHERE occurred_at = ?
      AND victim_steam_id = ?
      AND source = ?
      AND (
        (killer_steam_id IS NULL AND ? IS NULL)
        OR killer_steam_id = ?
      )
    LIMIT 1
  `).get(
    event.occurredAt,
    event.victimSteamId,
    event.source,
    event.killerSteamId,
    event.killerSteamId
  ) || null;
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

  const semanticExisting = getSemanticEvent(event);
  if (semanticExisting) {
    return { duplicate: true, event: semanticExisting, questChallenges: trackQuestChallenges(semanticExisting) };
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    const raced = getEvent(event.id);
    if (raced) {
      if (!sameEvent(raced, event)) throw feedError('COMBAT_EVENT_CONFLICT', 'Combat event ID already exists with different event data.');
      db.exec('COMMIT');
      return { duplicate: true, event: raced, questChallenges: trackQuestChallenges(raced) };
    }

    const semanticRaced = getSemanticEvent(event);
    if (semanticRaced) {
      db.exec('COMMIT');
      return { duplicate: true, event: semanticRaced, questChallenges: trackQuestChallenges(semanticRaced) };
    }

    db.prepare(`
      INSERT INTO combat_events
        (id, occurred_at, killer_steam_id, killer_name, victim_steam_id, victim_name, source)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.occurredAt,
      event.killerSteamId,
      event.killerName,
      event.victimSteamId,
      event.victimName,
      event.source
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

function getPlayerReset(steamId) {
  const id = validateSteamId(steamId);
  return db.prepare(`
    SELECT r.steam_id, r.reset_at, r.reason, r.updated_at, p.display_name
    FROM combat_stat_resets r
    LEFT JOIN combat_players p ON p.steam_id = r.steam_id
    WHERE r.steam_id = ?
  `).get(id) || null;
}

function resetPlayerStats(steamId, { reason = 'Admin reset', resetAt = new Date().toISOString() } = {}) {
  const id = validateSteamId(steamId);
  const parsed = new Date(resetAt);
  if (!Number.isFinite(parsed.getTime())) throw feedError('COMBAT_RESET_INVALID', 'Combat reset timestamp is invalid.');
  if (parsed.getTime() > Date.now() + 5 * 60 * 1000) throw feedError('COMBAT_RESET_INVALID', 'Combat reset timestamp is too far in the future.');
  const timestamp = parsed.toISOString();
  const cleanReason = String(reason || 'Admin reset').trim().slice(0, 240) || 'Admin reset';
  const previous = getPlayerReset(id);

  db.prepare(`
    INSERT INTO combat_stat_resets (steam_id, reset_at, reason, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(steam_id) DO UPDATE SET
      reset_at = excluded.reset_at,
      reason = excluded.reason,
      updated_at = datetime('now')
  `).run(id, timestamp, cleanReason);

  const current = getPlayerReset(id);
  return {
    steamId: id,
    displayName: current?.display_name || null,
    resetAt: current?.reset_at || timestamp,
    reason: current?.reason || cleanReason,
    previousResetAt: previous?.reset_at || null,
  };
}

function brisbaneCalendarWindow(period, nowMs = Date.now()) {
  const safeNow = Number(nowMs);
  if (!Number.isFinite(safeNow)) throw new Error('Invalid leaderboard clock');
  if (!['daily', 'weekly'].includes(period)) return null;

  const local = new Date(safeNow + BRISBANE_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const day = local.getUTCDate();
  let localStartMs = Date.UTC(year, month, day);

  if (period === 'weekly') {
    const daysSinceMonday = (local.getUTCDay() + 6) % 7;
    localStartMs -= daysSinceMonday * DAY_MS;
  }

  return {
    period,
    start: new Date(localStartMs - BRISBANE_OFFSET_MS).toISOString(),
    end: new Date(safeNow).toISOString(),
  };
}

function resolveLeaderboardWindow({ hours = 24 * 31, period = null, nowMs = Date.now() } = {}) {
  const calendar = brisbaneCalendarWindow(period, nowMs);
  if (calendar) {
    return {
      period: calendar.period,
      start: calendar.start,
      end: calendar.end,
      hours: Math.max(0, (Date.parse(calendar.end) - Date.parse(calendar.start)) / HOUR_MS),
    };
  }

  const safeHours = Math.max(1, Math.min(24 * 31, Number(hours) || 24 * 31));
  return {
    period: null,
    start: new Date(nowMs - safeHours * HOUR_MS).toISOString(),
    end: new Date(nowMs).toISOString(),
    hours: safeHours,
  };
}

function leaderboard({ hours = 24 * 31, period = null, limit = 100, nowMs = Date.now() } = {}) {
  const safeLimit = Math.max(1, Math.min(250, Number(limit) || 100));
  const window = resolveLeaderboardWindow({ hours, period, nowMs });
  const since = window.start;
  const until = window.end;

  const rows = db.prepare(`
    WITH
      kills AS (
        SELECT e.killer_steam_id AS steam_id, COUNT(*) AS kills
        FROM combat_events e
        LEFT JOIN combat_stat_resets r ON r.steam_id = e.killer_steam_id
        WHERE e.occurred_at >= ?
          AND e.occurred_at <= ?
          AND e.killer_steam_id IS NOT NULL
          AND e.killer_steam_id <> e.victim_steam_id
          AND (r.reset_at IS NULL OR e.occurred_at > r.reset_at)
        GROUP BY e.killer_steam_id
      ),
      deaths AS (
        SELECT e.victim_steam_id AS steam_id, COUNT(*) AS deaths
        FROM combat_events e
        LEFT JOIN combat_stat_resets r ON r.steam_id = e.victim_steam_id
        WHERE e.occurred_at >= ?
          AND e.occurred_at <= ?
          AND (r.reset_at IS NULL OR e.occurred_at > r.reset_at)
        GROUP BY e.victim_steam_id
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
  `).all(since, until, since, until).map((row) => {
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

  const mostDeaths = rows
    .filter((row) => row.deaths > 0)
    .sort((a, b) => b.deaths - a.deaths || b.kills - a.kills || a.username.localeCompare(b.username))
    .slice(0, safeLimit);

  const summary = db.prepare(`
    SELECT COUNT(*) AS event_count, MAX(occurred_at) AS latest_event_at
    FROM combat_events
    WHERE occurred_at >= ? AND occurred_at <= ?
  `).get(since, until);

  return {
    ...state(),
    period: window.period,
    windowHours: window.hours,
    windowStart: since,
    windowEnd: until,
    eventCount: Number(summary?.event_count) || 0,
    latestEventAt: summary?.latest_event_at || null,
    mostKills,
    bestKd,
    mostDeaths,
  };
}

module.exports = {
  enabled,
  configured,
  sourceName,
  state,
  normalizeEvent,
  ingestEvent,
  getPlayerReset,
  resetPlayerStats,
  brisbaneCalendarWindow,
  leaderboard,
  _test: { db, getEvent, getSemanticEvent, resolveLeaderboardWindow },
};
