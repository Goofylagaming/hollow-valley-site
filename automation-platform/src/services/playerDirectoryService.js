const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dbPath = process.env.AUTOMATION_DB_PATH || path.join(__dirname, '..', '..', 'data', 'automation.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA journal_mode = WAL;');

function listPlayers() {
  const rows = db.prepare(`
    SELECT
      p.steam_id,
      (
        SELECT p2.player_name
        FROM player_presence_sessions p2
        WHERE p2.steam_id = p.steam_id
          AND p2.player_name IS NOT NULL
          AND trim(p2.player_name) != ''
        ORDER BY datetime(p2.last_seen_at) DESC, datetime(p2.started_at) DESC
        LIMIT 1
      ) AS player_name,
      MIN(p.started_at) AS first_seen,
      MAX(p.last_seen_at) AS last_seen,
      SUM(
        MAX(
          0,
          CAST((julianday(COALESCE(p.ended_at, p.last_seen_at)) - julianday(p.started_at)) * 86400 AS INTEGER)
        )
      ) AS total_playtime_seconds,
      COUNT(*) AS session_count,
      MAX(CASE WHEN p.ended_at IS NULL THEN 1 ELSE 0 END) AS online
    FROM player_presence_sessions p
    GROUP BY p.steam_id
    ORDER BY datetime(last_seen) DESC, lower(COALESCE(player_name, '')) ASC, p.steam_id ASC
  `).all();

  return rows
    .filter((row) => /^\d{17}$/.test(String(row.steam_id || '')))
    .map((row) => ({
      name: String(row.player_name || 'Unknown player'),
      uniquePlayerId: String(row.steam_id),
      firstSeen: row.first_seen || null,
      lastSeen: row.last_seen || null,
      totalPlaytimeSeconds: Math.max(0, Number(row.total_playtime_seconds) || 0),
      sessionCount: Math.max(0, Number(row.session_count) || 0),
      online: Number(row.online) === 1,
    }));
}

module.exports = { listPlayers };
