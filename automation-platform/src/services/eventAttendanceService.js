const { randomUUID } = require('node:crypto');
const economy = require('./economyStore');
const supporterBonuses = require('./supporterBonusService');

const ATTENDANCE_BASE_VC_DEFAULT = 10000;
const EVENT_MULTIPLIER_BY_TIER = Object.freeze({
  supporter: 1.5,
  guardian: 3,
  legend: 5,
});

economy.db.exec(`
  CREATE TABLE IF NOT EXISTS event_attendance (
    event_id TEXT NOT NULL,
    steam_id TEXT NOT NULL,
    event_title TEXT NOT NULL,
    event_start TEXT,
    event_end TEXT,
    source TEXT NOT NULL DEFAULT 'website_rsvp',
    status TEXT NOT NULL DEFAULT 'attending',
    rsvp_at TEXT,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    added_by_steam_id TEXT,
    confirmed_at TEXT,
    confirmed_by_steam_id TEXT,
    reward_ledger_id TEXT,
    base_amount INTEGER,
    supporter_tier TEXT,
    supporter_multiplier REAL,
    payout_amount INTEGER,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (event_id, steam_id)
  );

  CREATE INDEX IF NOT EXISTS idx_event_attendance_event
    ON event_attendance(event_id, status, updated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_event_attendance_steam
    ON event_attendance(steam_id, updated_at DESC);
`);

function validateSteamId(value) {
  return economy.validateSteamId(value);
}

function validateEventId(value) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9:_-]{2,80}$/.test(id)) throw new Error('Event ID is invalid');
  return id;
}

function validateTitle(value) {
  const title = String(value || '').trim().replace(/\s+/g, ' ');
  if (title.length < 2 || title.length > 120) throw new Error('Event title must be 2-120 characters');
  return title;
}

function validateDate(value, { required = false } = {}) {
  if (value === null || value === undefined || value === '') {
    if (required) throw new Error('Event start time is required');
    return null;
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Event time is invalid');
  return date.toISOString();
}

function normalizeEvent(event = {}) {
  const startTime = validateDate(event.startTime || event.eventStart, { required: false });
  const endTime = validateDate(event.endTime || event.eventEnd, { required: false });
  if (startTime && endTime && Date.parse(endTime) < Date.parse(startTime)) {
    throw new Error('Event end time cannot be before its start time');
  }
  return {
    id: validateEventId(event.id || event.eventId),
    title: validateTitle(event.title || event.eventTitle),
    startTime,
    endTime,
  };
}

function attendanceBaseAmount(env = process.env) {
  const value = Number(env.EVENT_ATTENDANCE_BASE_VC || ATTENDANCE_BASE_VC_DEFAULT);
  if (!Number.isSafeInteger(value) || value <= 0 || value > 1000000) return ATTENDANCE_BASE_VC_DEFAULT;
  return value;
}

function multiplierForTier(tier) {
  const canonical = supporterBonuses.normalizeTier(tier);
  return canonical ? EVENT_MULTIPLIER_BY_TIER[canonical] || 1 : 1;
}

function tierLabel(tier) {
  const canonical = supporterBonuses.normalizeTier(tier);
  if (canonical === 'supporter') return 'Valley Member';
  if (canonical === 'guardian') return 'Valley Elite';
  if (canonical === 'legend') return 'Valley Legend';
  return 'Regular';
}

function mapRow(row) {
  if (!row) return null;
  return {
    eventId: row.event_id,
    steamId: row.steam_id,
    eventTitle: row.event_title,
    eventStart: row.event_start,
    eventEnd: row.event_end,
    source: row.source,
    status: row.status,
    rsvpAt: row.rsvp_at,
    addedAt: row.added_at,
    addedBySteamId: row.added_by_steam_id,
    confirmedAt: row.confirmed_at,
    confirmedBySteamId: row.confirmed_by_steam_id,
    rewardLedgerId: row.reward_ledger_id,
    baseAmount: row.base_amount === null ? null : Number(row.base_amount),
    supporterTier: row.supporter_tier,
    supporterTierLabel: tierLabel(row.supporter_tier),
    supporterMultiplier: row.supporter_multiplier === null ? null : Number(row.supporter_multiplier),
    payoutAmount: row.payout_amount === null ? null : Number(row.payout_amount),
  };
}

function getAttendance(eventId, steamId) {
  const id = validateEventId(eventId);
  const steam = validateSteamId(steamId);
  return mapRow(economy.db.prepare(
    'SELECT * FROM event_attendance WHERE event_id = ? AND steam_id = ?'
  ).get(id, steam));
}

function listAttendance({ eventId = null, steamId = null, includeWithdrawn = false, limit = 500 } = {}) {
  const clauses = [];
  const params = [];
  if (eventId) {
    clauses.push('event_id = ?');
    params.push(validateEventId(eventId));
  }
  if (steamId) {
    clauses.push('steam_id = ?');
    params.push(validateSteamId(steamId));
  }
  if (!includeWithdrawn) clauses.push("status <> 'withdrawn'");
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 500));
  return economy.db.prepare(`
    SELECT * FROM event_attendance
    ${where}
    ORDER BY COALESCE(event_start, added_at) DESC, added_at DESC
    LIMIT ?
  `).all(...params, safeLimit).map(mapRow);
}

function upsertAttendee({
  steamId,
  event,
  source = 'website_rsvp',
  addedBySteamId = null,
}) {
  const steam = validateSteamId(steamId);
  const snapshot = normalizeEvent(event);
  const actor = addedBySteamId ? validateSteamId(addedBySteamId) : null;
  const existing = getAttendance(snapshot.id, steam);

  if (existing?.status === 'paid') return { duplicate: true, attendance: existing };

  const now = new Date().toISOString();
  economy.db.prepare(`
    INSERT INTO event_attendance
      (event_id, steam_id, event_title, event_start, event_end, source, status, rsvp_at, added_at, added_by_steam_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'attending', ?, ?, ?, ?)
    ON CONFLICT(event_id, steam_id) DO UPDATE SET
      event_title = excluded.event_title,
      event_start = COALESCE(excluded.event_start, event_attendance.event_start),
      event_end = COALESCE(excluded.event_end, event_attendance.event_end),
      source = excluded.source,
      status = CASE WHEN event_attendance.status = 'paid' THEN 'paid' ELSE 'attending' END,
      rsvp_at = COALESCE(excluded.rsvp_at, event_attendance.rsvp_at),
      added_by_steam_id = COALESCE(excluded.added_by_steam_id, event_attendance.added_by_steam_id),
      updated_at = excluded.updated_at
  `).run(
    snapshot.id,
    steam,
    snapshot.title,
    snapshot.startTime,
    snapshot.endTime,
    String(source || 'website_rsvp').slice(0, 32),
    source === 'website_rsvp' ? now : null,
    now,
    actor,
    now
  );

  return { duplicate: Boolean(existing), attendance: getAttendance(snapshot.id, steam) };
}

function withdrawAttendee({ steamId, eventId }) {
  const steam = validateSteamId(steamId);
  const id = validateEventId(eventId);
  const current = getAttendance(id, steam);
  if (!current) return { changed: false, attendance: null };
  if (current.status === 'paid') {
    const error = new Error('Paid event attendance cannot be withdrawn');
    error.code = 'EVENT_ATTENDANCE_ALREADY_PAID';
    throw error;
  }
  economy.db.prepare(`
    UPDATE event_attendance
    SET status = 'withdrawn', updated_at = datetime('now')
    WHERE event_id = ? AND steam_id = ?
  `).run(id, steam);
  return { changed: true, attendance: getAttendance(id, steam) };
}

async function refreshMembership(steamId, env = process.env) {
  if (!supporterBonuses.enabled(env)) {
    return supporterBonuses.membershipForSteamId(steamId, env);
  }
  if (!supporterBonuses.configuration(env)) {
    const error = new Error('Supporter lookup is not configured; event reward was not issued');
    error.code = 'EVENT_REWARD_SUPPORTER_LOOKUP_UNAVAILABLE';
    throw error;
  }
  try {
    await supporterBonuses.refreshMemberships([steamId], { env });
    return supporterBonuses.membershipForSteamId(steamId, env);
  } catch (cause) {
    const error = new Error('Supporter lookup failed; event reward was not issued');
    error.code = 'EVENT_REWARD_SUPPORTER_LOOKUP_FAILED';
    error.cause = cause;
    throw error;
  }
}

function requireRewardsEnabled(env = process.env) {
  if (!/^(1|true|yes)$/i.test(String(env.EVENT_REWARDS_ENABLED || '').trim())) {
    const error = new Error('Event rewards are disabled');
    error.code = 'EVENT_REWARDS_DISABLED';
    throw error;
  }
}

async function confirmAttendance({
  eventId,
  steamId,
  confirmedBySteamId = null,
}, { env = process.env, membershipOverride = null } = {}) {
  requireRewardsEnabled(env);
  const id = validateEventId(eventId);
  const steam = validateSteamId(steamId);
  const actor = confirmedBySteamId ? validateSteamId(confirmedBySteamId) : null;
  const attendance = getAttendance(id, steam);
  if (!attendance || attendance.status === 'withdrawn') {
    const error = new Error('Player is not on the attending list for this event');
    error.code = 'EVENT_ATTENDANCE_NOT_FOUND';
    throw error;
  }

  const base = attendanceBaseAmount(env);
  const idempotencyKey = `event-attendance:${id}:${steam}`;
  const existing = economy.getLedgerByIdempotency(idempotencyKey);

  let membership;
  let multiplier;
  let payout;
  let transaction;
  let wallet;
  let duplicate = false;

  if (existing) {
    const metadata = existing.metadata || {};
    membership = {
      tier: metadata.supporterTier || null,
      entitled: Boolean(metadata.supporterTier),
    };
    multiplier = Number(metadata.supporterMultiplier || 1);
    payout = Number(existing.amount || metadata.payoutAmount || base);
    transaction = existing;
    wallet = economy.getWallet(steam);
    duplicate = true;
  } else {
    membership = membershipOverride || await refreshMembership(steam, env);
    multiplier = multiplierForTier(membership.tier);
    payout = Math.round(base * multiplier);

    const result = economy.applyWalletTransaction({
      steamId: steam,
      amount: payout,
      kind: 'event_attendance_reward',
      reason: `Event attendance: ${attendance.eventTitle}`,
      idempotencyKey,
      referenceType: 'event',
      referenceId: id,
      metadata: {
        rewardType: 'attendance',
        eventId: id,
        eventTitle: attendance.eventTitle,
        eventStart: attendance.eventStart,
        eventEnd: attendance.eventEnd,
        baseAmount: base,
        supporterTier: membership.tier || null,
        supporterTierLabel: tierLabel(membership.tier),
        supporterMultiplier: multiplier,
        payoutAmount: payout,
        confirmedBySteamId: actor,
      },
    });
    duplicate = Boolean(result.duplicate);
    transaction = result.transaction;
    wallet = result.wallet;
  }

  economy.db.prepare(`
    UPDATE event_attendance
    SET status = 'paid',
        confirmed_at = COALESCE(confirmed_at, datetime('now')),
        confirmed_by_steam_id = COALESCE(confirmed_by_steam_id, ?),
        reward_ledger_id = ?,
        base_amount = ?,
        supporter_tier = ?,
        supporter_multiplier = ?,
        payout_amount = ?,
        updated_at = datetime('now')
    WHERE event_id = ? AND steam_id = ?
  `).run(
    actor,
    transaction?.id || null,
    base,
    membership?.tier || null,
    multiplier,
    payout,
    id,
    steam
  );

  return {
    duplicate,
    attendance: getAttendance(id, steam),
    baseAmount: base,
    supporterTier: membership?.tier || null,
    supporterTierLabel: tierLabel(membership?.tier),
    supporterMultiplier: multiplier,
    payoutAmount: payout,
    transaction,
    wallet,
  };
}

async function confirmAll({ eventId, confirmedBySteamId = null }, options = {}) {
  const id = validateEventId(eventId);
  const env = options.env || process.env;
  requireRewardsEnabled(env);

  const attendees = listAttendance({ eventId: id, includeWithdrawn: false, limit: 1000 })
    .filter((entry) => entry.status !== 'paid');

  if (supporterBonuses.enabled(env) && attendees.length) {
    if (!supporterBonuses.configuration(env)) {
      const error = new Error('Supporter lookup is not configured; event rewards were not issued');
      error.code = 'EVENT_REWARD_SUPPORTER_LOOKUP_UNAVAILABLE';
      throw error;
    }
    try {
      await supporterBonuses.refreshMemberships(attendees.map((entry) => entry.steamId), { env });
    } catch (cause) {
      const error = new Error('Supporter lookup failed; event rewards were not issued');
      error.code = 'EVENT_REWARD_SUPPORTER_LOOKUP_FAILED';
      error.cause = cause;
      throw error;
    }
  }

  const results = [];
  for (const attendance of attendees) {
    try {
      const membershipOverride = supporterBonuses.membershipForSteamId(attendance.steamId, env);
      results.push({
        ok: true,
        steamId: attendance.steamId,
        ...(await confirmAttendance({
          eventId: id,
          steamId: attendance.steamId,
          confirmedBySteamId,
        }, { env, membershipOverride })),
      });
    } catch (error) {
      results.push({
        ok: false,
        steamId: attendance.steamId,
        error: error.message,
        code: error.code || null,
      });
    }
  }

  return {
    eventId: id,
    attempted: attendees.length,
    paid: results.filter((entry) => entry.ok && !entry.duplicate).length,
    duplicates: results.filter((entry) => entry.ok && entry.duplicate).length,
    failed: results.filter((entry) => !entry.ok).length,
    payoutAmount: results.filter((entry) => entry.ok).reduce((sum, entry) => sum + Number(entry.payoutAmount || 0), 0),
    results,
  };
}

function validateBonusAmount(value) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000) {
    throw new Error('Bonus payout must be a whole number between 1 and 1,000,000');
  }
  return amount;
}

function validateBonusLabel(value) {
  const label = String(value || 'Event bonus').trim().replace(/\s+/g, ' ');
  if (label.length < 2 || label.length > 100) throw new Error('Bonus label must be 2-100 characters');
  return label;
}

async function awardBonus({
  steamId,
  eventId,
  eventTitle,
  amount,
  label,
  bonusId = randomUUID(),
  applySupporterMultiplier = false,
  awardedBySteamId = null,
}, { env = process.env } = {}) {
  requireRewardsEnabled(env);
  const steam = validateSteamId(steamId);
  const id = validateEventId(eventId);
  const title = validateTitle(eventTitle);
  const base = validateBonusAmount(amount);
  const safeLabel = validateBonusLabel(label);
  const safeBonusId = String(bonusId || '').trim();
  if (!/^[A-Za-z0-9:_-]{8,160}$/.test(safeBonusId)) throw new Error('Bonus ID is invalid');
  const actor = awardedBySteamId ? validateSteamId(awardedBySteamId) : null;
  const idempotencyKey = `event-bonus:${id}:${steam}:${safeBonusId}`;

  const existing = economy.getLedgerByIdempotency(idempotencyKey);
  if (existing) {
    const metadata = existing.metadata || {};
    return {
      duplicate: true,
      bonusId: safeBonusId,
      event: { id, title: metadata.eventTitle || title },
      label: metadata.bonusLabel || safeLabel,
      baseAmount: Number(metadata.baseAmount || base),
      supporterTier: metadata.supporterTier || null,
      supporterTierLabel: tierLabel(metadata.supporterTier),
      supporterMultiplier: Number(metadata.supporterMultiplier || 1),
      payoutAmount: Number(existing.amount || metadata.payoutAmount || base),
      transaction: existing,
      wallet: economy.getWallet(steam),
    };
  }

  let membership = { tier: null, entitled: false };
  let multiplier = 1;
  if (applySupporterMultiplier) {
    membership = await refreshMembership(steam, env);
    multiplier = multiplierForTier(membership.tier);
  }
  const payout = Math.round(base * multiplier);

  const result = economy.applyWalletTransaction({
    steamId: steam,
    amount: payout,
    kind: 'event_bonus_reward',
    reason: `${safeLabel}: ${title}`,
    idempotencyKey,
    referenceType: 'event',
    referenceId: id,
    metadata: {
      rewardType: 'bonus',
      bonusId: safeBonusId,
      bonusLabel: safeLabel,
      eventId: id,
      eventTitle: title,
      baseAmount: base,
      supporterTier: membership.tier || null,
      supporterTierLabel: tierLabel(membership.tier),
      supporterMultiplier: multiplier,
      payoutAmount: payout,
      applySupporterMultiplier: Boolean(applySupporterMultiplier),
      awardedBySteamId: actor,
    },
  });

  return {
    duplicate: Boolean(result.duplicate),
    bonusId: safeBonusId,
    event: { id, title },
    label: safeLabel,
    baseAmount: base,
    supporterTier: membership.tier || null,
    supporterTierLabel: tierLabel(membership.tier),
    supporterMultiplier: multiplier,
    payoutAmount: payout,
    transaction: result.transaction,
    wallet: result.wallet,
  };
}

function state(env = process.env) {
  return {
    enabled: /^(1|true|yes)$/i.test(String(env.EVENT_REWARDS_ENABLED || '').trim()),
    baseAttendanceVc: attendanceBaseAmount(env),
    supporterLookupConfigured: Boolean(supporterBonuses.configuration(env)),
    supporterMultipliersEnabled: supporterBonuses.enabled(env),
    attendanceMultipliers: {
      regular: 1,
      member: EVENT_MULTIPLIER_BY_TIER.supporter,
      elite: EVENT_MULTIPLIER_BY_TIER.guardian,
      legend: EVENT_MULTIPLIER_BY_TIER.legend,
    },
  };
}

module.exports = {
  ATTENDANCE_BASE_VC_DEFAULT,
  EVENT_MULTIPLIER_BY_TIER,
  validateSteamId,
  validateEventId,
  validateTitle,
  normalizeEvent,
  attendanceBaseAmount,
  multiplierForTier,
  tierLabel,
  getAttendance,
  listAttendance,
  upsertAttendee,
  withdrawAttendee,
  confirmAttendance,
  confirmAll,
  awardBonus,
  state,
};
