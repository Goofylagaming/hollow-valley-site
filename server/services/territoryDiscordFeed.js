const { db } = require('../db');
const automation = require('./automationWebsiteClient');
const { ALLOWED_STEAM_IDS } = require('../middleware/requireTerritoryAdmin');

const INTERVAL_MS = 8000;
const RELAY_KINDS = new Set(['status', 'attack', 'contest', 'capture', 'defence', 'kill']);
const MENTION_RE = /^\d{17,20}$/;
let timer = null;
let running = false;

function ensureSchema() {
  // An isolated delivery cursor. First activation primes at the latest log
  // instead of flooding Discord with historical test events.
  db.exec(`
    CREATE TABLE IF NOT EXISTS territory_discord_feed_cursor (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      last_log_id INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.prepare(`
    INSERT OR IGNORE INTO territory_discord_feed_cursor(id, last_log_id)
    SELECT 1, COALESCE(MAX(id), 0) FROM territory_event_log
  `).run();
}

function nextLogRows(limit = 25) {
  ensureSchema();
  return db.prepare(`
    SELECT l.id AS logId, l.event_id AS eventId, l.kind, l.message, l.created_at AS loggedAt,
           e.territory_name AS territoryName, e.owner_name AS ownerName,
           e.challenger_name AS challengerName
    FROM territory_event_log l
    JOIN territory_events e ON e.id = l.event_id
    WHERE l.id > (SELECT last_log_id FROM territory_discord_feed_cursor WHERE id = 1)
    ORDER BY l.id ASC
    LIMIT ?
  `).all(Math.max(1, Math.min(25, Number(limit) || 25)));
}

function advanceCursor(logId) {
  db.prepare(`
    UPDATE territory_discord_feed_cursor
    SET last_log_id = MAX(last_log_id, ?), updated_at = datetime('now')
    WHERE id = 1
  `).run(Number(logId));
}

function linkedDefenders(eventId) {
  const attack = db.prepare(`
    SELECT id, defender_group_id, starts_at, status
    FROM territory_attacks
    WHERE event_id = ?
    ORDER BY id DESC LIMIT 1
  `).get(Number(eventId));

  const startsAt = Date.parse(String(attack?.starts_at || ''));
  const warningIsCurrent = Number.isFinite(startsAt) && startsAt > Date.now();
  if (!warningIsCurrent) return { ids: [], startsAt: attack?.starts_at || null };

  let rows = [];
  if (attack?.defender_group_id) {
    rows = db.prepare(`
      SELECT DISTINCT u.discord_id AS discordId
      FROM territory_group_members m
      JOIN users u ON u.id = m.user_id
      WHERE m.group_id = ?
        AND u.discord_id IS NOT NULL
        AND (m.role IN ('leader', 'officer') OR EXISTS (
          SELECT 1 FROM territory_event_lineups l
          WHERE l.event_id = ? AND l.group_id = m.group_id AND l.user_id = m.user_id
        ))
      ORDER BY CASE WHEN m.role = 'leader' THEN 0 ELSE 1 END
      LIMIT 6
    `).all(attack.defender_group_id, Number(eventId));
  } else {
    // If the owner is the system-admin team, only notify the four designated
    // Territory admins, never every website admin.
    const event = db.prepare('SELECT owner_name FROM territory_events WHERE id = ?')
      .get(Number(eventId));
    if (String(event?.owner_name || '').trim().toLowerCase() === 'admin') {
      const placeholders = ALLOWED_STEAM_IDS.map(() => '?').join(',');
      rows = db.prepare(`
        SELECT discord_id AS discordId FROM users
        WHERE is_admin = 1 AND steam_id IN (${placeholders})
          AND discord_id IS NOT NULL LIMIT 4
      `).all(...ALLOWED_STEAM_IDS);
    }
  }

  return {
    ids: [...new Set(rows.map(row => String(row.discordId || '').trim())
      .filter(id => MENTION_RE.test(id)))].slice(0, 6),
    startsAt: attack.starts_at,
  };
}

function toFeedEvent(log) {
  const warning = String(log.kind) === 'attack' &&
    /five-minute warning started/i.test(String(log.message));
  const defender = warning ? linkedDefenders(log.eventId) : { ids: [], startsAt: null };
  return {
    ...log,
    fiveMinuteWarning: warning,
    defenderDiscordIds: defender.ids,
    attackStartsAt: defender.startsAt,
  };
}

async function syncOnce() {
  if (running) return { skipped: 'already-running' };
  running = true;
  let forwarded = 0;
  try {
    for (const row of nextLogRows(25)) {
      if (RELAY_KINDS.has(String(row.kind || '').toLowerCase())) {
        await automation.publishTerritoryWarFeedEvent(toFeedEvent(row));
        forwarded += 1;
      }
      // Only advance after the durable HerbyBot outbox accepted this event.
      advanceCursor(row.logId);
    }
    return { forwarded };
  } finally {
    running = false;
  }
}

function start() {
  if (timer) return;
  ensureSchema();
  timer = setInterval(() => {
    syncOnce().catch(error => {
      console.warn('[territory-discord-feed]', error.message);
    });
  }, INTERVAL_MS);
  timer.unref?.();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  start,
  stop,
  syncOnce,
  _test: { ensureSchema, nextLogRows, advanceCursor, linkedDefenders, toFeedEvent },
};
