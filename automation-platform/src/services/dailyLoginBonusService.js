const store = require('./economyStore');
const supporterBonuses = require('./supporterBonusService');

function enabled() {
  return String(process.env.WALLET_DAILY_LOGIN_BONUS_ENABLED || '').toLowerCase() === 'true';
}

function amount() {
  const value = Number(process.env.WALLET_DAILY_LOGIN_BONUS_COINS || 0);
  return Number.isSafeInteger(value) ? Math.max(0, Math.min(1000000, value)) : 0;
}

function timezone() {
  return String(process.env.ECONOMY_TIMEZONE || 'Australia/Brisbane').trim() || 'Australia/Brisbane';
}

function dayKey(now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function status(steamId, { now = new Date() } = {}) {
  const id = store.validateSteamId(steamId);
  const key = dayKey(now);
  const reward = amount();
  const ledgerKey = `daily-login:${id}:${key}`;
  const transaction = store.getLedgerByIdempotency(ledgerKey);
  const supporter = supporterBonuses.applyBonus(reward, id);
  return {
    enabled: enabled(),
    amount: reward,
    baseAmount: reward,
    effectiveAmount: supporter.payoutCoins,
    supporterTier: supporter.tier,
    supporterMultiplier: supporter.multiplier,
    timezone: timezone(),
    dayKey: key,
    claimed: Boolean(transaction),
    claimable: enabled() && reward > 0 && !transaction,
    transaction: transaction || null,
  };
}

async function claim(steamId, { now = new Date() } = {}) {
  const id = store.validateSteamId(steamId);
  try {
    await supporterBonuses.refreshMemberships([id]);
  } catch (error) {
    // Fail closed for the paid bonus while preserving the base daily reward.
  }
  const current = status(id, { now });
  if (!current.enabled || current.baseAmount <= 0) {
    const error = new Error('Daily login bonus is disabled');
    error.code = 'DAILY_LOGIN_BONUS_DISABLED';
    throw error;
  }

  const supporter = supporterBonuses.applyBonus(current.baseAmount, id);
  const payoutAmount = supporter.payoutCoins;

  const result = store.applyWalletTransaction({
    steamId: id,
    amount: payoutAmount,
    kind: 'daily_login_bonus',
    reason: [
      `Daily login bonus (${current.dayKey}): ${current.baseAmount} base`,
      supporter.multiplier > 1 ? `×${supporter.multiplier} ${supporter.tier} supporter multiplier` : null,
    ].filter(Boolean).join(' '),
    idempotencyKey: `daily-login:${id}:${current.dayKey}`,
    referenceType: 'daily_login',
    referenceId: current.dayKey,
    metadata: {
      dayKey: current.dayKey,
      timezone: current.timezone,
      baseAmount: current.baseAmount,
      supporterTier: supporter.tier,
      supporterMultiplier: supporter.multiplier,
      supporterBonusCoins: supporter.supporterBonusCoins,
      payoutAmount,
    },
  });

  return {
    duplicate: Boolean(result.duplicate),
    dayKey: current.dayKey,
    amount: payoutAmount,
    baseAmount: current.baseAmount,
    supporterTier: supporter.tier,
    supporterMultiplier: supporter.multiplier,
    supporterBonusCoins: supporter.supporterBonusCoins,
    wallet: result.wallet,
    transaction: result.transaction,
  };
}

module.exports = {
  enabled,
  amount,
  timezone,
  dayKey,
  status,
  claim,
};
