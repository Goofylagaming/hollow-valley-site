const economy = require('./economyStore');
const supporterBonuses = require('./supporterBonusService');

function enabled(env = process.env) {
  return /^(1|true|yes)$/i.test(String(env.EVENT_REWARDS_ENABLED || '').trim());
}

function validateSteamId(value) {
  return economy.validateSteamId(value);
}

function validateEventId(value) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9:_-]{2,80}$/.test(id)) throw new Error('Event ID is invalid');
  return id;
}

function validateEventTitle(value) {
  const title = String(value || '').trim().replace(/\s+/g, ' ');
  if (title.length < 2 || title.length > 120) throw new Error('Event title must be 2-120 characters');
  return title;
}

function validateBaseAmount(value) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000) {
    throw new Error('Event reward must be a whole number between 1 and 1,000,000');
  }
  return amount;
}

function parseMetadata(value) {
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}

function state(env = process.env) {
  return {
    enabled: enabled(env),
    supporterMultipliersEnabled: supporterBonuses.enabled(env),
    supporterLookupConfigured: Boolean(supporterBonuses.configuration(env)),
  };
}

async function refreshSupporter(steamId, env = process.env) {
  if (!supporterBonuses.enabled(env)) return;

  if (!supporterBonuses.configuration(env)) {
    const error = new Error('Supporter lookup is not configured; event reward was not issued');
    error.code = 'EVENT_REWARD_SUPPORTER_LOOKUP_UNAVAILABLE';
    throw error;
  }

  try {
    await supporterBonuses.refreshMemberships([steamId], { env });
  } catch (cause) {
    const error = new Error('Supporter lookup failed; event reward was not issued');
    error.code = 'EVENT_REWARD_SUPPORTER_LOOKUP_FAILED';
    error.cause = cause;
    throw error;
  }
}

async function awardReward({
  steamId,
  eventId,
  eventTitle,
  baseAmount,
}, { env = process.env } = {}) {
  if (!enabled(env)) {
    const error = new Error('Event rewards are disabled');
    error.code = 'EVENT_REWARDS_DISABLED';
    throw error;
  }

  const steam = validateSteamId(steamId);
  const id = validateEventId(eventId);
  const title = validateEventTitle(eventTitle);
  const base = validateBaseAmount(baseAmount);
  const idempotencyKey = `event-reward:${id}:${steam}`;

  const existing = economy.getLedgerByIdempotency(idempotencyKey);
  if (existing) {
    const metadata = existing.metadata || {};
    return {
      duplicate: true,
      event: { id, title: metadata.eventTitle || title },
      baseAmount: Number(metadata.baseAmount || 0),
      supporterTier: metadata.supporterTier || null,
      supporterMultiplier: Number(metadata.supporterMultiplier || 1),
      supporterBonusCoins: Number(metadata.supporterBonusCoins || 0),
      payoutAmount: Number(existing.amount || metadata.payoutAmount || 0),
      transaction: existing,
      wallet: economy.getWallet(steam),
    };
  }

  await refreshSupporter(steam, env);
  const supporter = supporterBonuses.applyBonus(base, steam, env);

  const result = economy.applyWalletTransaction({
    steamId: steam,
    amount: supporter.payoutCoins,
    kind: 'event_reward',
    reason: `Event reward: ${title}`,
    idempotencyKey,
    referenceType: 'event',
    referenceId: id,
    metadata: {
      eventId: id,
      eventTitle: title,
      baseAmount: base,
      supporterTier: supporter.tier,
      supporterMultiplier: supporter.multiplier || 1,
      supporterBonusCoins: supporter.supporterBonusCoins,
      payoutAmount: supporter.payoutCoins,
    },
  });

  return {
    duplicate: Boolean(result.duplicate),
    event: { id, title },
    baseAmount: base,
    supporterTier: supporter.tier,
    supporterMultiplier: supporter.multiplier || 1,
    supporterBonusCoins: supporter.supporterBonusCoins,
    payoutAmount: supporter.payoutCoins,
    transaction: result.transaction,
    wallet: result.wallet,
  };
}

function listRewards({ steamId = null, limit = 100 } = {}) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const params = [];
  let where = "kind = 'event_reward'";

  if (steamId) {
    where += ' AND steam_id = ?';
    params.push(validateSteamId(steamId));
  }

  return economy.db.prepare(`
    SELECT id, steam_id, amount, reason, reference_id, metadata_json, created_at
    FROM economy_wallet_ledger
    WHERE ${where}
    ORDER BY created_at DESC, rowid DESC
    LIMIT ?
  `).all(...params, safeLimit).map((row) => ({
    id: row.id,
    steamId: row.steam_id,
    amount: Number(row.amount) || 0,
    reason: row.reason,
    eventId: row.reference_id,
    metadata: parseMetadata(row.metadata_json),
    createdAt: row.created_at,
  }));
}

module.exports = {
  enabled,
  state,
  validateEventId,
  validateEventTitle,
  validateBaseAmount,
  awardReward,
  listRewards,
};
