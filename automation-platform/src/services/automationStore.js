const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dbPath = process.env.AUTOMATION_DB_PATH || path.join(__dirname, '..', '..', 'data', 'automation.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec(`
  CREATE TABLE IF NOT EXISTS automation_requests (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    steam_id TEXT,
    status TEXT NOT NULL,
    command_id TEXT UNIQUE,
    details_json TEXT NOT NULL DEFAULT '{}',
    message TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_automation_requests_kind_status
    ON automation_requests(kind, status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_automation_requests_steam_kind
    ON automation_requests(steam_id, kind, created_at DESC);

  CREATE TABLE IF NOT EXISTS automation_jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled',
    run_at TEXT NOT NULL,
    recurrence TEXT NOT NULL DEFAULT 'none',
    payload_json TEXT NOT NULL DEFAULT '{}',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    last_run_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_automation_jobs_due
    ON automation_jobs(status, run_at);

  CREATE TABLE IF NOT EXISTS automation_audit (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL,
    details_json TEXT NOT NULL DEFAULT '{}',
    message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_automation_audit_created
    ON automation_audit(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_automation_audit_category_action
    ON automation_audit(category, action, created_at DESC);

  CREATE TABLE IF NOT EXISTS automation_state (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

function parseJson(value) {
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}

function parseRow(row) {
  if (!row) return null;
  return { ...row, details: parseJson(row.details_json) };
}

function parseJob(row) {
  if (!row) return null;
  return { ...row, payload: parseJson(row.payload_json) };
}

function parseAudit(row) {
  if (!row) return null;
  return { ...row, details: parseJson(row.details_json) };
}

function createRequest({ id, kind, steamId = null, status = 'queued', commandId = null, details = {}, message = null, error = null }) {
  db.prepare(`
    INSERT INTO automation_requests (id, kind, steam_id, status, command_id, details_json, message, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, kind, steamId, status, commandId, JSON.stringify(details), message, error);
  return getRequest(id);
}

function getRequest(id) {
  return parseRow(db.prepare('SELECT * FROM automation_requests WHERE id = ?').get(id));
}

function updateRequest(id, fields = {}) {
  const current = getRequest(id);
  if (!current) return null;
  const next = {
    status: fields.status ?? current.status,
    commandId: fields.commandId ?? current.command_id,
    details: fields.details ?? current.details,
    message: fields.message ?? current.message,
    error: fields.error ?? current.error,
  };
  db.prepare(`
    UPDATE automation_requests
    SET status = ?, command_id = ?, details_json = ?, message = ?, error = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(next.status, next.commandId, JSON.stringify(next.details), next.message, next.error, id);
  return getRequest(id);
}

function listRequests({ kind = null, statuses = null, limit = 100 } = {}) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const clauses = [];
  const params = [];
  if (kind) {
    clauses.push('kind = ?');
    params.push(kind);
  }
  if (Array.isArray(statuses) && statuses.length) {
    clauses.push(`status IN (${statuses.map(() => '?').join(',')})`);
    params.push(...statuses);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`SELECT * FROM automation_requests ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...params, safeLimit)
    .map(parseRow);
}

function getLatestForSteam(steamId, kind) {
  return parseRow(db.prepare(`
    SELECT * FROM automation_requests
    WHERE steam_id = ? AND kind = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(steamId, kind));
}

function createJob({ id, type, runAt, recurrence = 'none', payload = {} }) {
  db.prepare(`
    INSERT INTO automation_jobs (id, type, status, run_at, recurrence, payload_json)
    VALUES (?, ?, 'scheduled', ?, ?, ?)
  `).run(id, type, runAt, recurrence, JSON.stringify(payload));
  return getJob(id);
}

function getJob(id) {
  return parseJob(db.prepare('SELECT * FROM automation_jobs WHERE id = ?').get(id));
}

function updateJob(id, fields = {}) {
  const current = getJob(id);
  if (!current) return null;
  const next = {
    status: fields.status ?? current.status,
    runAt: fields.runAt ?? current.run_at,
    recurrence: fields.recurrence ?? current.recurrence,
    payload: fields.payload ?? current.payload,
    attempts: fields.attempts ?? current.attempts,
    lastError: fields.lastError === undefined ? current.last_error : fields.lastError,
    lastRunAt: fields.lastRunAt === undefined ? current.last_run_at : fields.lastRunAt,
  };
  db.prepare(`
    UPDATE automation_jobs
    SET status = ?, run_at = ?, recurrence = ?, payload_json = ?, attempts = ?, last_error = ?, last_run_at = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(next.status, next.runAt, next.recurrence, JSON.stringify(next.payload), next.attempts, next.lastError, next.lastRunAt, id);
  return getJob(id);
}

function listJobs({ statuses = null, limit = 100 } = {}) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const clauses = [];
  const params = [];
  if (Array.isArray(statuses) && statuses.length) {
    clauses.push(`status IN (${statuses.map(() => '?').join(',')})`);
    params.push(...statuses);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`SELECT * FROM automation_jobs ${where} ORDER BY run_at ASC LIMIT ?`)
    .all(...params, safeLimit)
    .map(parseJob);
}

function listDueJobs(nowIso = new Date().toISOString(), limit = 25) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 25));
  return db.prepare(`
    SELECT * FROM automation_jobs
    WHERE status = 'scheduled' AND run_at <= ?
    ORDER BY run_at ASC LIMIT ?
  `).all(nowIso, safeLimit).map(parseJob);
}

function recoverInterruptedJobs() {
  return db.prepare(`
    UPDATE automation_jobs
    SET status = 'scheduled', last_error = 'Recovered after service restart before completion', updated_at = datetime('now')
    WHERE status = 'running'
  `).run().changes;
}

function createAudit({ id, category, action, status = 'started', details = {}, message = null }) {
  db.prepare(`
    INSERT INTO automation_audit (id, category, action, status, details_json, message)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, category, action, status, JSON.stringify(details), message);
  return getAudit(id);
}

function getAudit(id) {
  return parseAudit(db.prepare('SELECT * FROM automation_audit WHERE id = ?').get(id));
}

function updateAudit(id, fields = {}) {
  const current = getAudit(id);
  if (!current) return null;
  const next = {
    status: fields.status ?? current.status,
    details: fields.details ?? current.details,
    message: fields.message === undefined ? current.message : fields.message,
  };
  db.prepare(`
    UPDATE automation_audit
    SET status = ?, details_json = ?, message = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(next.status, JSON.stringify(next.details), next.message, id);
  return getAudit(id);
}

function listAudit({ category = null, action = null, statuses = null, limit = 100 } = {}) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const clauses = [];
  const params = [];
  if (category) {
    clauses.push('category = ?');
    params.push(category);
  }
  if (action) {
    clauses.push('action = ?');
    params.push(action);
  }
  if (Array.isArray(statuses) && statuses.length) {
    clauses.push(`status IN (${statuses.map(() => '?').join(',')})`);
    params.push(...statuses);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`SELECT * FROM automation_audit ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...params, safeLimit)
    .map(parseAudit);
}

function getState(key, fallback = null) {
  const row = db.prepare('SELECT value_json, updated_at FROM automation_state WHERE key = ?').get(String(key));
  if (!row) return fallback;
  return { value: parseJson(row.value_json), updatedAt: row.updated_at };
}

function setState(key, value) {
  const name = String(key || '').trim();
  if (!name) throw new Error('State key is required');
  db.prepare(`
    INSERT INTO automation_state (key, value_json, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = datetime('now')
  `).run(name, JSON.stringify(value ?? {}));
  return getState(name);
}

function deleteState(key) {
  return db.prepare('DELETE FROM automation_state WHERE key = ?').run(String(key)).changes;
}

module.exports = {
  dbPath,
  createRequest,
  getRequest,
  updateRequest,
  listRequests,
  getLatestForSteam,
  createJob,
  getJob,
  updateJob,
  listJobs,
  listDueJobs,
  recoverInterruptedJobs,
  createAudit,
  getAudit,
  updateAudit,
  listAudit,
  getState,
  setState,
  deleteState,
};
