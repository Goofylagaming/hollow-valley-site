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
`);

function parseRow(row) {
  if (!row) return null;
  let details = {};
  try { details = JSON.parse(row.details_json || '{}'); } catch {}
  return { ...row, details };
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

module.exports = {
  dbPath,
  createRequest,
  getRequest,
  updateRequest,
  listRequests,
  getLatestForSteam,
};
