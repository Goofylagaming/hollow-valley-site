const { randomUUID } = require('node:crypto');
const economy = require('./economyStore');

const db = economy.db;
const MINUTE_MS = 60_000;
const MAX_SAMPLE_GAP_MS = 90_000;
const MAX_COINS_PER_MINUTE = 1_000;
const MAX_DURATION_MINUTES = 12 * 60;

db.exec(
  "CREATE TABLE IF NOT EXISTS species_coin_events (" +
    "id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, title TEXT NOT NULL," +
    "species_key TEXT NOT NULL, coins_per_minute INTEGER NOT NULL," +
    "starts_at_ms INTEGER NOT NULL, ends_at_ms INTEGER NOT NULL," +
    "status TEXT NOT NULL DEFAULT 'scheduled', created_by TEXT," +
    "stopped_at_ms INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))" +
  ");" +
  "CREATE INDEX IF NOT EXISTS idx_species_events_window ON species_coin_events(starts_at_ms, ends_at_ms, status);" +
  "CREATE TABLE IF NOT EXISTS species_coin_event_progress (" +
    "event_id TEXT NOT NULL, steam_id TEXT NOT NULL, last_seen_ms INTEGER NOT NULL," +
    "species_key TEXT NOT NULL, accrued_ms INTEGER NOT NULL DEFAULT 0," +
    "rewarded_minutes INTEGER NOT NULL DEFAULT 0," +
    "PRIMARY KEY(event_id, steam_id)" +
  ");"
);

function enabled() {
  return process.env.SPECIES_COIN_EVENTS_ENABLED === 'true';
}

function eventError(message, code = 'SPECIES_EVENT_INVALID') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function canonicalSpecies(value) {
  const species = String(value || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  return /^[a-z]{3,40}$/.test(species) ? species : null;
}

function statusFor(row, nowMs = Date.now()) {
  if (row.status === 'stopped') return 'stopped';
  if (nowMs >= Number(row.ends_at_ms)) return 'expired';
  if (nowMs < Number(row.starts_at_ms)) return 'scheduled';
  return 'active';
}

function view(row, nowMs = Date.now()) {
  if (!row) return null;
  return {
    id: row.id, requestId: row.request_id, title: row.title,
    species: row.species_key, coinsPerMinute: Number(row.coins_per_minute),
    startsAt: new Date(Number(row.starts_at_ms)).toISOString(),
    endsAt: new Date(Number(row.ends_at_ms)).toISOString(),
    status: statusFor(row, nowMs), createdBy: row.created_by,
    stoppedAt: row.stopped_at_ms == null ? null : new Date(Number(row.stopped_at_ms)).toISOString(),
  };
}

function listEvents({ limit = 40, nowMs = Date.now() } = {}) {
  return {
    enabled: enabled(),
    verifiedPresenceRequired: true,
    minutePayouts: true,
    perSpeciesGrowthSupported: false,
    maxCoinsPerMinute: MAX_COINS_PER_MINUTE,
    maxDurationMinutes: MAX_DURATION_MINUTES,
    events: db.prepare(
      'SELECT * FROM species_coin_events ORDER BY created_at DESC, rowid DESC LIMIT ?'
    ).all(Math.min(100, Math.max(1, Number(limit) || 40))).map(row => view(row, nowMs)),
  };
}

function validateEvent(input, nowMs) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) eventError('Event settings are required');
  const requestId = String(input.requestId || '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,32}$/.test(requestId)) eventError('A UUID request ID is required');
  const title = String(input.title || '').trim();
  if (!title || title.length > 90 || /[\x00-\x1f]/.test(title)) eventError('Event title must be 1–90 characters');
  const species = canonicalSpecies(input.species);
  if (!species) eventError('Select a valid dinosaur species');
  const coins = input.coinsPerMinute;
  if (!Number.isSafeInteger(coins) || coins < 1 || coins > MAX_COINS_PER_MINUTE) {
    eventError('Bonus must be a whole number from 1 to 1,000 Valley Coins per minute');
  }
  const duration = input.durationMinutes;
  if (!Number.isSafeInteger(duration) || duration < 5 || duration > MAX_DURATION_MINUTES) {
    eventError('Event duration must be 5–720 minutes');
  }
  const start = input.startsAt == null ? nowMs : Date.parse(String(input.startsAt));
  if (!Number.isFinite(start) || start < nowMs - 30_000 || start > nowMs + 30 * 86_400_000) {
    eventError('Start time must be now or within the next 30 days');
  }
  if (input.growthMultiplier != null) {
    eventError('Species-specific growth overrides are not yet verified by the game server', 'SPECIES_GROWTH_UNSUPPORTED');
  }
  const actorSteamId = String(input.actorSteamId || '').trim();
  if (!/^\d{17}$/.test(actorSteamId)) eventError('Steam-linked admin identity is required');
  return { requestId, title, species, coins, start, end: start + duration * MINUTE_MS, actorSteamId };
}

function createEvent(input, { nowMs = Date.now() } = {}) {
  if (!enabled()) eventError('Species coin events are disabled by the server', 'SPECIES_EVENT_DISABLED');
  const p = validateEvent(input, nowMs);
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = db.prepare('SELECT * FROM species_coin_events WHERE request_id = ?').get(p.requestId);
    if (existing) {
      if (existing.title !== p.title || existing.species_key !== p.species ||
          Number(existing.coins_per_minute) !== p.coins || Number(existing.starts_at_ms) !== p.start ||
          Number(existing.ends_at_ms) !== p.end || existing.created_by !== p.actorSteamId) {
        eventError('This request ID was already used for different event settings', 'SPECIES_EVENT_CONFLICT');
      }
      db.exec('COMMIT');
      return { duplicate: true, event: view(existing, nowMs) };
    }

    const overlapping = db.prepare(
      "SELECT id FROM species_coin_events WHERE species_key = ? AND status != 'stopped' " +
      'AND ends_at_ms > ? AND starts_at_ms < ? LIMIT 1'
    ).get(p.species, p.start, p.end);
    if (overlapping) eventError('An overlapping bonus event already exists for this dinosaur', 'SPECIES_EVENT_CONFLICT');

    const id = randomUUID();
    db.prepare(
      'INSERT INTO species_coin_events ' +
      '(id, request_id, title, species_key, coins_per_minute, starts_at_ms, ends_at_ms, created_by) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, p.requestId, p.title, p.species, p.coins, p.start, p.end, p.actorSteamId);
    const row = db.prepare('SELECT * FROM species_coin_events WHERE id = ?').get(id);
    db.exec('COMMIT');
    return { duplicate: false, event: view(row, nowMs) };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function stopEvent(id, { nowMs = Date.now() } = {}) {
  const key = String(id || '').trim();
  const row = db.prepare('SELECT * FROM species_coin_events WHERE id = ?').get(key);
  if (!row) eventError('Species event was not found', 'SPECIES_EVENT_NOT_FOUND');
  if (row.status === 'stopped') return { duplicate: true, event: view(row, nowMs) };
  db.prepare(
    "UPDATE species_coin_events SET status = 'stopped', stopped_at_ms = ? WHERE id = ? AND status != 'stopped'"
  ).run(nowMs, row.id);
  return { duplicate: false, event: view(db.prepare('SELECT * FROM species_coin_events WHERE id = ?').get(row.id), nowMs) };
}

function processSnapshot(players, { nowMs = Date.now() } = {}) {
  if (!enabled()) return { skipped: true, reason: 'disabled', intervals: 0, coins: 0 };
  if (!Number.isSafeInteger(nowMs)) eventError('Snapshot timestamp must be a millisecond integer');
  if (!Array.isArray(players)) eventError('Authoritative player snapshot is required');
  const events = db.prepare(
    "SELECT * FROM species_coin_events WHERE status != 'stopped' " +
    'AND starts_at_ms <= ? AND ends_at_ms > ?'
  ).all(nowMs, nowMs - MAX_SAMPLE_GAP_MS);

  let intervals = 0, coins = 0, eligible = 0, errors = 0;
  for (const event of events) {
    for (const player of players) {
      const steamId = String(player?.steamId || '').trim();
      if (!/^\d{17}$/.test(steamId)) continue;
      const species = canonicalSpecies(player?.species);
      const prior = db.prepare(
        'SELECT * FROM species_coin_event_progress WHERE event_id = ? AND steam_id = ?'
      ).get(event.id, steamId);

      if (!prior) {
        if (species === event.species_key && nowMs < Number(event.ends_at_ms)) {
          db.prepare(
            'INSERT OR IGNORE INTO species_coin_event_progress ' +
            '(event_id, steam_id, last_seen_ms, species_key) VALUES (?, ?, ?, ?)'
          ).run(event.id, steamId, nowMs, species);
        }
        continue;
      }
      if (nowMs <= Number(prior.last_seen_ms)) continue;
      const delta = nowMs - Number(prior.last_seen_ms);
      const uninterrupted = delta <= MAX_SAMPLE_GAP_MS &&
        species === event.species_key && species === prior.species_key;
      if (!uninterrupted) {
        db.prepare(
          'UPDATE species_coin_event_progress SET last_seen_ms = ?, species_key = ?, accrued_ms = 0 WHERE event_id = ? AND steam_id = ?'
        ).run(nowMs, species || '', event.id, steamId);
        continue;
      }
      const ms = Math.max(0,
        Math.min(nowMs, Number(event.ends_at_ms)) -
        Math.max(Number(prior.last_seen_ms), Number(event.starts_at_ms)));
      const accrued = Number(prior.accrued_ms) + ms;
      const due = Math.floor(accrued / MINUTE_MS);
      const previousCount = Number(prior.rewarded_minutes);
      try {
        for (let index = 1; index <= due; index += 1) {
          const sequence = previousCount + index;
          const key = 'species-minute:' + event.id + ':' + steamId + ':' + sequence;
          const receipt = economy.applyWalletTransaction({
            steamId, amount: Number(event.coins_per_minute), kind: 'species_event_bonus',
            reason: event.title + ' — ' + event.species_key + ' playtime',
            idempotencyKey: key, referenceType: 'species_bonus_event', referenceId: event.id,
            metadata: {
              species: event.species_key, coinsPerMinute: Number(event.coins_per_minute),
              sequence, intervalSeconds: 60,
              // Flat event amount; supporter and quest multipliers apply to
              // their existing normal reward stream, not this extra credit.
              supporterMultiplierApplied: false,
            },
          });
          if (!receipt.duplicate) {
            intervals++;
            coins += Number(event.coins_per_minute);
          }
        }
        db.prepare(
          'UPDATE species_coin_event_progress SET last_seen_ms = ?, accrued_ms = ?, rewarded_minutes = ? ' +
          'WHERE event_id = ? AND steam_id = ?'
        ).run(nowMs, accrued % MINUTE_MS, previousCount + due, event.id, steamId);
        eligible++;
      } catch (error) {
        errors++;
        console.warn('[species-coin-events] payout failed', error.code || error.message);
        // Do not mark a minute paid without durable idempotent ledger credit.
      }
    }
  }
  return { skipped: false, eligiblePlayers: eligible, intervals, coins, errors };
}

module.exports = {
  enabled, canonicalSpecies, validateEvent, statusFor, listEvents,
  createEvent, stopEvent, processSnapshot, MAX_SAMPLE_GAP_MS,
};
