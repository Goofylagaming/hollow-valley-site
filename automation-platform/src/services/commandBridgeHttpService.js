const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dbPath = process.env.AUTOMATION_DB_PATH || path.join(__dirname, '..', '..', 'data', 'automation.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA journal_mode = WAL;');
db.exec(`
  CREATE TABLE IF NOT EXISTS command_bridge_http_requests (
    id TEXT PRIMARY KEY,
    verb TEXT NOT NULL,
    steam TEXT NOT NULL,
    expected_source TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    result_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    dispatched_at TEXT,
    acknowledged_at TEXT,
    completed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_command_bridge_http_status_created
    ON command_bridge_http_requests(status, created_at ASC);
`);

const MAX_BATCH = 10;
const DEFAULT_ACTION_QUEUE_COOLDOWN_MS = 2000;
const DEFAULT_ACTION_QUEUE_LOCK_TIMEOUT_MS = 45000;

function boundedMs(name, fallback, min, max) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function actionQueueSettings() {
  return {
    enabled: process.env.GAME_ACTION_QUEUE_ENABLED !== 'false',
    cooldownMs: boundedMs('GAME_ACTION_QUEUE_COOLDOWN_MS', DEFAULT_ACTION_QUEUE_COOLDOWN_MS, 0, 30000),
    lockTimeoutMs: boundedMs('GAME_ACTION_QUEUE_LOCK_TIMEOUT_MS', DEFAULT_ACTION_QUEUE_LOCK_TIMEOUT_MS, 5000, 300000),
  };
}

function cleanupOldRows() {
  db.prepare(`
    DELETE FROM command_bridge_http_requests
    WHERE datetime(created_at) < datetime('now', '-7 days')
      AND status = 'completed'
  `).run();
}

function enqueue(command, expectedSource) {
  cleanupOldRows();
  const payload = JSON.stringify(command);
  const existing = db.prepare(`
    SELECT id, payload, expected_source
    FROM command_bridge_http_requests
    WHERE id = ?
  `).get(command.id);

  if (existing) {
    if (existing.payload !== payload || existing.expected_source !== expectedSource) {
      const error = new Error('CommandBridge request ID already exists with different content');
      error.code = 'COMMAND_BRIDGE_CONFLICT';
      throw error;
    }
    return existing.id;
  }

  db.prepare(`
    INSERT INTO command_bridge_http_requests
      (id, verb, steam, expected_source, payload, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `).run(command.id, command.verb, command.steam, expectedSource, payload);

  return command.id;
}

function activeAction() {
  return db.prepare(`
    SELECT id, verb, steam, status,
           CAST((julianday('now') - julianday(COALESCE(acknowledged_at, dispatched_at, created_at))) * 86400000 AS INTEGER) AS age_ms
    FROM command_bridge_http_requests
    WHERE status IN ('dispatched', 'acknowledged')
    ORDER BY datetime(COALESCE(acknowledged_at, dispatched_at, created_at)) DESC
    LIMIT 1
  `).get() || null;
}

function lastCompletedAction() {
  return db.prepare(`
    SELECT id, verb, steam,
           CAST((julianday('now') - julianday(completed_at)) * 86400000 AS INTEGER) AS age_ms
    FROM command_bridge_http_requests
    WHERE status = 'completed' AND completed_at IS NOT NULL
    ORDER BY datetime(completed_at) DESC
    LIMIT 1
  `).get() || null;
}

function actionQueueState() {
  const settings = actionQueueSettings();
  const active = activeAction();
  const lastCompleted = lastCompletedAction();
  const activeAgeMs = Number(active?.age_ms);
  const completedAgeMs = Number(lastCompleted?.age_ms);
  const lockedByActive = Boolean(
    settings.enabled && active && Number.isFinite(activeAgeMs) && activeAgeMs < settings.lockTimeoutMs
  );
  const coolingDown = Boolean(
    settings.enabled && lastCompleted && Number.isFinite(completedAgeMs) && completedAgeMs < settings.cooldownMs
  );

  return {
    ...settings,
    locked: lockedByActive || coolingDown,
    reason: lockedByActive ? 'action_in_flight' : coolingDown ? 'cooldown' : null,
    active: active ? {
      id: active.id,
      verb: active.verb,
      steam: active.steam,
      status: active.status,
      ageMs: activeAgeMs,
      stale: Number.isFinite(activeAgeMs) ? activeAgeMs >= settings.lockTimeoutMs : false,
    } : null,
    lastCompleted: lastCompleted ? {
      id: lastCompleted.id,
      verb: lastCompleted.verb,
      steam: lastCompleted.steam,
      ageMs: completedAgeMs,
    } : null,
  };
}

function claimPending(limit = MAX_BATCH) {
  const settings = actionQueueSettings();
  const safeLimit = settings.enabled ? 1 : Math.max(1, Math.min(MAX_BATCH, Number(limit) || MAX_BATCH));
  const claimed = [];

  db.exec('BEGIN IMMEDIATE');
  try {
    // Anti-crash queue: while enabled, only one CommandBridge action may be in
    // flight at a time. Parking, BodyDrop, Prime, restore/admin actions and skin
    // mutations all converge here before the BinaryLane agent can touch UE4SS.
    // A stale in-flight row stops blocking after lockTimeoutMs, but is never
    // re-dispatched; this avoids duplicate game mutations after a lost result.
    if (settings.enabled) {
      const state = actionQueueState();
      if (state.locked) {
        db.exec('COMMIT');
        return [];
      }
    }

    const rows = db.prepare(`
      SELECT id, payload
      FROM command_bridge_http_requests
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT ?
    `).all(safeLimit);

    const mark = db.prepare(`
      UPDATE command_bridge_http_requests
      SET status = 'dispatched',
          dispatched_at = datetime('now')
      WHERE id = ? AND status = 'pending'
    `);

    for (const row of rows) {
      const result = mark.run(row.id);
      if (Number(result.changes || 0) === 1) claimed.push(row.payload);
    }

    db.exec('COMMIT');
    return claimed;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

function acceptResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return { accepted: false, reason: 'invalid_result' };
  }

  const id = String(result.id || '').trim();
  if (!id) return { accepted: false, reason: 'missing_id' };

  const row = db.prepare(`
    SELECT id, verb, steam, expected_source, status, result_json
    FROM command_bridge_http_requests
    WHERE id = ?
  `).get(id);

  if (!row) return { accepted: false, reason: 'unknown_id' };
  if (String(result.steam || '') !== row.steam) {
    return { accepted: false, reason: 'steam_mismatch' };
  }
  if (typeof result.ok !== 'boolean' || typeof result.msg !== 'string') {
    return { accepted: false, reason: 'invalid_schema' };
  }

  const source = result.source == null ? null : String(result.source);

  if (row.status === 'completed' && row.result_json === JSON.stringify(result)) {
    return { accepted: true, duplicate: true, final: true };
  }

  if (source === row.expected_source) {
    db.prepare(`
      UPDATE command_bridge_http_requests
      SET status = 'completed',
          result_json = ?,
          completed_at = datetime('now')
      WHERE id = ?
    `).run(JSON.stringify(result), id);
    return { accepted: true, final: true };
  }

  if (source == null) {
    if (result.verb != null && String(result.verb) !== row.verb) {
      return { accepted: false, reason: 'verb_mismatch' };
    }

    if (result.ok === false) {
      db.prepare(`
        UPDATE command_bridge_http_requests
        SET status = 'completed',
            result_json = ?,
            completed_at = datetime('now')
        WHERE id = ?
      `).run(JSON.stringify(result), id);
      return { accepted: true, final: true };
    }

    db.prepare(`
      UPDATE command_bridge_http_requests
      SET status = 'acknowledged',
          result_json = ?,
          acknowledged_at = datetime('now')
      WHERE id = ? AND status != 'completed'
    `).run(JSON.stringify(result), id);
    return { accepted: true, final: false };
  }

  // A result from an unrelated sub-mod is not allowed to complete this request.
  return { accepted: true, final: false, ignoredSource: source };
}

function getRequest(id) {
  return db.prepare(`
    SELECT id, verb, steam, expected_source, status, result_json,
           created_at, dispatched_at, acknowledged_at, completed_at
    FROM command_bridge_http_requests
    WHERE id = ?
  `).get(String(id || '').trim()) || null;
}

function getSummary() {
  const rows = db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM command_bridge_http_requests
    GROUP BY status
  `).all();

  const summary = {
    pending: 0,
    dispatched: 0,
    acknowledged: 0,
    completed: 0,
    total: 0,
  };

  for (const row of rows) {
    const count = Number(row.count) || 0;
    if (Object.hasOwn(summary, row.status)) summary[row.status] = count;
    summary.total += count;
  }

  return {
    ...summary,
    actionQueue: actionQueueState(),
  };
}

module.exports = {
  enqueue,
  claimPending,
  acceptResult,
  getRequest,
  getSummary,
  actionQueueSettings,
  actionQueueState,
};
