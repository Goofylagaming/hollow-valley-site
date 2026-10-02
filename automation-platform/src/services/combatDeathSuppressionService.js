const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dbPath = process.env.AUTOMATION_DB_PATH || path.join(__dirname, '..', '..', 'data', 'automation.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA journal_mode = WAL;');
db.exec(`
  CREATE TABLE IF NOT EXISTS combat_death_suppressions (
    request_id TEXT PRIMARY KEY,
    steam_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    cancelled_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_combat_death_suppressions_active
    ON combat_death_suppressions(steam_id, starts_at, expires_at);

  CREATE TABLE IF NOT EXISTS combat_suppressed_events (
    event_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    steam_id TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_combat_suppressed_events_semantic
    ON combat_suppressed_events(steam_id, occurred_at);
`);

function validSteamId(value) {
  const steamId = String(value || '').trim();
  if (!/^\d{17}$/.test(steamId)) throw new Error('A valid 17-digit Steam ID is required');
  return steamId;
}

function validRequestId(value) {
  const requestId = String(value || '').trim();
  if (!requestId) throw new Error('A CommandBridge request ID is required');
  return requestId.slice(0, 200);
}

function arm({ requestId, steamId, reason = 'dinostorage_store', ttlSeconds = 30, nowMs = Date.now() }) {
  const id = validRequestId(requestId);
  const steam = validSteamId(steamId);
  const ttl = Math.max(5, Math.min(120, Number(ttlSeconds) || 30));
  const start = new Date(Number(nowMs)).toISOString();
  const expires = new Date(Number(nowMs) + ttl * 1000).toISOString();
  const cleanReason = String(reason || 'dinostorage_store').trim().slice(0, 120) || 'dinostorage_store';

  db.prepare(`
    INSERT INTO combat_death_suppressions
      (request_id, steam_id, reason, starts_at, expires_at, consumed_at, cancelled_at)
    VALUES (?, ?, ?, ?, ?, NULL, NULL)
    ON CONFLICT(request_id) DO UPDATE SET
      steam_id = excluded.steam_id,
      reason = excluded.reason,
      starts_at = excluded.starts_at,
      expires_at = excluded.expires_at,
      consumed_at = NULL,
      cancelled_at = NULL
  `).run(id, steam, cleanReason, start, expires);

  return { requestId: id, steamId: steam, reason: cleanReason, startsAt: start, expiresAt: expires };
}

function cancel(requestId) {
  const id = validRequestId(requestId);
  const result = db.prepare(`
    UPDATE combat_death_suppressions
    SET cancelled_at = datetime('now')
    WHERE request_id = ? AND cancelled_at IS NULL AND consumed_at IS NULL
  `).run(id);
  return Number(result.changes || 0) > 0;
}

function findSuppressedReplay(event) {
  return db.prepare(`
    SELECT event_id, request_id, steam_id, occurred_at, reason
    FROM combat_suppressed_events
    WHERE event_id = ?
       OR (steam_id = ? AND occurred_at = ?)
    ORDER BY created_at DESC
    LIMIT 1
  `).get(event.id, event.victimSteamId, event.occurredAt) || null;
}

function consumeNaturalDeath(event) {
  if (!event || event.killerSteamId) return null;
  const steam = validSteamId(event.victimSteamId);
  const occurredAt = new Date(event.occurredAt).toISOString();
  const eventId = String(event.id || '').trim();
  if (!eventId) throw new Error('Combat event ID is required for suppression');

  const replay = findSuppressedReplay({ id: eventId, victimSteamId: steam, occurredAt });
  if (replay) return { ...replay, replay: true };

  db.exec('BEGIN IMMEDIATE');
  try {
    const suppression = db.prepare(`
      SELECT request_id, steam_id, reason, starts_at, expires_at
      FROM combat_death_suppressions
      WHERE steam_id = ?
        AND consumed_at IS NULL
        AND cancelled_at IS NULL
        AND starts_at <= ?
        AND expires_at >= ?
      ORDER BY starts_at DESC
      LIMIT 1
    `).get(steam, occurredAt, occurredAt);

    if (!suppression) {
      db.exec('COMMIT');
      return null;
    }

    db.prepare(`
      UPDATE combat_death_suppressions
      SET consumed_at = datetime('now')
      WHERE request_id = ? AND consumed_at IS NULL AND cancelled_at IS NULL
    `).run(suppression.request_id);

    db.prepare(`
      INSERT OR IGNORE INTO combat_suppressed_events
        (event_id, request_id, steam_id, occurred_at, reason)
      VALUES (?, ?, ?, ?, ?)
    `).run(eventId, suppression.request_id, steam, occurredAt, suppression.reason);

    db.exec('COMMIT');
    return {
      event_id: eventId,
      request_id: suppression.request_id,
      steam_id: steam,
      occurred_at: occurredAt,
      reason: suppression.reason,
      replay: false,
    };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

module.exports = {
  arm,
  cancel,
  consumeNaturalDeath,
  _test: { db, findSuppressedReplay },
};
