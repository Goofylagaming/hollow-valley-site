const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { getServerSnapshot } = require('./statusService');

const dbPath = process.env.AUTOMATION_DB_PATH || path.join(__dirname, '..', '..', 'data', 'automation.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec(`
  CREATE TABLE IF NOT EXISTS server_health_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    checked_at TEXT NOT NULL,
    online INTEGER NOT NULL,
    player_count INTEGER NOT NULL DEFAULT 0,
    max_players INTEGER,
    error_code TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_server_health_checked
    ON server_health_samples(checked_at DESC);
`);

let sampling = false;

function enabled() {
  return String(process.env.SERVER_HEALTH_HISTORY_ENABLED || '').toLowerCase() === 'true';
}

function intervalMs() {
  const value = Number(process.env.SERVER_HEALTH_HISTORY_INTERVAL_MS || 60000);
  return Math.max(30000, Math.min(600000, Number.isFinite(value) ? value : 60000));
}

function retentionHours() {
  const value = Number(process.env.SERVER_HEALTH_HISTORY_RETENTION_HOURS || 24 * 30);
  return Math.max(24, Math.min(24 * 365, Number.isFinite(value) ? value : 24 * 30));
}

function classifyError(error) {
  const message = String(error || '').toLowerCase();
  if (!message) return null;
  if (message.includes('auth')) return 'auth';
  if (message.includes('timeout')) return 'timeout';
  if (message.includes('refused')) return 'refused';
  if (message.includes('reset')) return 'reset';
  if (message.includes('dns') || message.includes('enotfound')) return 'dns';
  return 'unavailable';
}

function recordSample({ online, playerCount = 0, maxPlayers = null, error = null, checkedAt = new Date().toISOString() }) {
  db.prepare(`
    INSERT INTO server_health_samples (checked_at, online, player_count, max_players, error_code)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    checkedAt,
    online ? 1 : 0,
    Math.max(0, Number(playerCount) || 0),
    Number.isFinite(Number(maxPlayers)) ? Number(maxPlayers) : null,
    classifyError(error)
  );
  return { checkedAt, online: Boolean(online), playerCount: Math.max(0, Number(playerCount) || 0) };
}

function pruneSamples() {
  const cutoff = new Date(Date.now() - retentionHours() * 60 * 60 * 1000).toISOString();
  return db.prepare('DELETE FROM server_health_samples WHERE checked_at < ?').run(cutoff).changes;
}

async function sampleServerHealth({ force = false } = {}) {
  if (sampling) return { skipped: true, reason: 'sample-already-running' };
  if (!enabled()) return { skipped: true, reason: 'disabled' };
  sampling = true;
  try {
    const snapshot = await getServerSnapshot({ force });
    if (!snapshot.configured) return { skipped: true, reason: 'rcon-not-configured' };
    const result = recordSample({
      online: snapshot.online,
      playerCount: snapshot.players?.length || 0,
      maxPlayers: snapshot.maxPlayers,
      error: snapshot.error,
      checkedAt: snapshot.checkedAt || new Date().toISOString(),
    });
    pruneSamples();
    return { skipped: false, ...result };
  } finally {
    sampling = false;
  }
}

function getHealthAnalytics({ hours = 24, nowMs = Date.now() } = {}) {
  const safeHours = Math.max(1, Math.min(24 * 31, Number(hours) || 24));
  const since = new Date(nowMs - safeHours * 60 * 60 * 1000).toISOString();
  const rows = db.prepare(`
    SELECT checked_at, online, player_count, max_players, error_code
    FROM server_health_samples
    WHERE checked_at >= ?
    ORDER BY checked_at ASC
  `).all(since);

  const samples = rows.length;
  const onlineSamples = rows.filter((row) => row.online === 1).length;
  const playerSamples = rows.filter((row) => row.online === 1);
  const totalPlayers = playerSamples.reduce((sum, row) => sum + row.player_count, 0);
  const peakPlayers = playerSamples.reduce((max, row) => Math.max(max, row.player_count), 0);
  const maxPlayers = [...rows].reverse().find((row) => Number.isFinite(row.max_players))?.max_players ?? null;
  const errors = {};
  for (const row of rows) {
    if (!row.error_code) continue;
    errors[row.error_code] = (errors[row.error_code] || 0) + 1;
  }

  let outageTransitions = 0;
  let previousOnline = null;
  for (const row of rows) {
    const online = row.online === 1;
    if (previousOnline === true && online === false) outageTransitions += 1;
    previousOnline = online;
  }

  return {
    enabled: enabled(),
    hours: safeHours,
    samples,
    onlineSamples,
    availabilityPercent: samples ? Math.round((onlineSamples / samples) * 10000) / 100 : null,
    averagePlayers: playerSamples.length ? Math.round((totalPlayers / playerSamples.length) * 10) / 10 : 0,
    peakPlayers,
    maxPlayers,
    outageTransitions,
    errors,
    firstSampleAt: rows[0]?.checked_at || null,
    lastSampleAt: rows.at(-1)?.checked_at || null,
  };
}

function startServerHealthHistory() {
  if (!enabled()) return null;
  sampleServerHealth({ force: false }).catch((error) => console.warn('[server-health-history]', error.message));
  const timer = setInterval(() => {
    sampleServerHealth({ force: false }).catch((error) => console.warn('[server-health-history]', error.message));
  }, intervalMs());
  timer.unref?.();
  return timer;
}

module.exports = {
  enabled,
  intervalMs,
  retentionHours,
  classifyError,
  recordSample,
  pruneSamples,
  sampleServerHealth,
  getHealthAnalytics,
  startServerHealthHistory,
};
