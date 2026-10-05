const { db } = require('../db');

const KILL_MOMENTUM_WINDOW_MS = 60 * 1000;
const KILL_MOMENTUM_RATE_PER_KILL = 1;
const KILL_MOMENTUM_RATE_CAP = 2;

function ensureSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS territory_kill_momentum (
      combat_event_id TEXT PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES territory_events(id) ON DELETE CASCADE,
      attack_id INTEGER NOT NULL REFERENCES territory_attacks(id) ON DELETE CASCADE,
      side TEXT NOT NULL CHECK (side IN ('attacker', 'defender')),
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_territory_kill_momentum_window
      ON territory_kill_momentum(event_id, attack_id, occurred_at DESC);
  `);
}

function parseDate(value) {
  const date = new Date(value || '');
  return Number.isFinite(date.getTime()) ? date : null;
}

function recordKill({ combatEventId, eventId, attackId, side, occurredAt }) {
  ensureSchema();
  const id = String(combatEventId || '').trim();
  const event = Number(eventId);
  const attack = Number(attackId);
  const normalizedSide = String(side || '').toLowerCase();
  const occurred = parseDate(occurredAt);
  if (!id || !Number.isInteger(event) || event <= 0 || !Number.isInteger(attack) || attack <= 0) return false;
  if (!['attacker', 'defender'].includes(normalizedSide) || !occurred) return false;

  const result = db.prepare(`
    INSERT OR IGNORE INTO territory_kill_momentum
      (combat_event_id, event_id, attack_id, side, occurred_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, event, attack, normalizedSide, occurred.toISOString());
  return Number(result.changes || 0) > 0;
}

function recentMomentum(eventId, attackId, nowMs = Date.now()) {
  ensureSchema();
  const event = Number(eventId);
  const attack = Number(attackId);
  if (!Number.isInteger(event) || event <= 0 || !Number.isInteger(attack) || attack <= 0) {
    return {
      attackerKills: 0,
      defenderKills: 0,
      netKills: 0,
      ratePerMinute: 0,
      windowSeconds: KILL_MOMENTUM_WINDOW_MS / 1000,
      rateCap: KILL_MOMENTUM_RATE_CAP,
    };
  }

  const since = new Date(Number(nowMs) - KILL_MOMENTUM_WINDOW_MS).toISOString();
  const until = new Date(Number(nowMs)).toISOString();
  const rows = db.prepare(`
    SELECT side, COUNT(*) AS n
    FROM territory_kill_momentum
    WHERE event_id = ?
      AND attack_id = ?
      AND datetime(occurred_at) >= datetime(?)
      AND datetime(occurred_at) <= datetime(?)
    GROUP BY side
  `).all(event, attack, since, until);

  const counts = Object.fromEntries(rows.map((row) => [row.side, Number(row.n) || 0]));
  const attackerKills = counts.attacker || 0;
  const defenderKills = counts.defender || 0;
  const rawNet = attackerKills - defenderKills;
  const netKills = Math.max(-KILL_MOMENTUM_RATE_CAP, Math.min(KILL_MOMENTUM_RATE_CAP, rawNet));
  return {
    attackerKills,
    defenderKills,
    netKills,
    ratePerMinute: netKills * KILL_MOMENTUM_RATE_PER_KILL,
    windowSeconds: KILL_MOMENTUM_WINDOW_MS / 1000,
    rateCap: KILL_MOMENTUM_RATE_CAP,
  };
}

module.exports = {
  KILL_MOMENTUM_WINDOW_MS,
  KILL_MOMENTUM_RATE_PER_KILL,
  KILL_MOMENTUM_RATE_CAP,
  ensureSchema,
  recordKill,
  recentMomentum,
};
