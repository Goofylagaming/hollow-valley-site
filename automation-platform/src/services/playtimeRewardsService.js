const { randomUUID } = require('node:crypto');
const store = require('./economyStore');
const quests = require('./questBoostService');

const db = store.db;

function enabled() {
  return String(process.env.WALLET_PLAYTIME_REWARDS_ENABLED || '').toLowerCase() === 'true';
}

function coinsPerInterval() {
  const value = Number(process.env.WALLET_PLAYTIME_COINS_PER_5_MINUTES || 0);
  return Number.isSafeInteger(value) ? Math.max(0, Math.min(100000, value)) : 0;
}

function intervalSeconds() {
  return 300;
}

function maxSampleGapSeconds() {
  const value = Number(process.env.WALLET_PLAYTIME_MAX_SAMPLE_GAP_SECONDS || 90);
  return Math.max(30, Math.min(600, Number.isFinite(value) ? value : 90));
}

function state() {
  return {
    enabled: enabled(),
    coinsPer5Minutes: coinsPerInterval(),
    intervalSeconds: intervalSeconds(),
    maxSampleGapSeconds: maxSampleGapSeconds(),
    configured: coinsPerInterval() > 0,
  };
}

function rewardOnlinePlayers(players, { nowMs = Date.now() } = {}) {
  const rewardEnabled = enabled();
  const coins = coinsPerInterval();
  const payoutsEnabled = rewardEnabled && coins > 0;

  const ids = [...new Set((players || [])
    .map((player) => String(player?.steamId || '').trim())
    .filter((steamId) => /^\d{17}$/.test(steamId)))];

  let rewardedPlayers = 0;
  let coinsAwarded = 0;
  let intervalsAwarded = 0;
  const intervalMs = intervalSeconds() * 1000;
  const maxGapMs = maxSampleGapSeconds() * 1000;

  for (const steamId of ids) {
    db.exec('BEGIN IMMEDIATE');
    try {
      store.ensureWallet(steamId);
      const prior = db.prepare('SELECT * FROM economy_playtime_progress WHERE steam_id = ?').get(steamId);
      const elapsedMs = prior ? Math.max(0, Number(nowMs) - Number(prior.last_seen_ms)) : 0;
      const continuous = Boolean(prior && elapsedMs > 0 && elapsedMs <= maxGapMs);
      const countElapsed = continuous ? elapsedMs : 0;
      const questProgress = quests.updateQuestProgress(steamId, {
        elapsedSeconds: Math.floor(countElapsed / 1000),
        continuous,
        nowMs,
      });
      const activeBoostPercent = Number(questProgress.quests.activeBoostPercent || 0);
      const accruedMs = payoutsEnabled
        ? Math.max(0, Number(prior?.accrued_ms || 0)) + countElapsed
        : 0;
      const due = payoutsEnabled ? Math.floor(accruedMs / intervalMs) : 0;
      const remainder = payoutsEnabled ? accruedMs % intervalMs : 0;
      let rewardedIntervals = Number(prior?.rewarded_intervals || 0);

      if (payoutsEnabled && due > 0) {
        for (let index = 0; index < due; index += 1) {
          const sequence = rewardedIntervals + 1;
          const key = `playtime:${steamId}:${sequence}`;
          const existing = db.prepare('SELECT id FROM economy_wallet_ledger WHERE idempotency_key = ?').get(key);
          if (!existing) {
            const bonusCoins = Math.floor((coins * activeBoostPercent) / 100);
            const payoutCoins = coins + bonusCoins;
            const wallet = db.prepare('SELECT balance FROM economy_wallets WHERE steam_id = ?').get(steamId);
            const nextBalance = Number(wallet.balance) + payoutCoins;
            db.prepare('UPDATE economy_wallets SET balance = ?, updated_at = datetime(\'now\') WHERE steam_id = ?')
              .run(nextBalance, steamId);
            db.prepare(`
              INSERT INTO economy_wallet_ledger
                (id, steam_id, amount, kind, reason, idempotency_key, reference_type, reference_id, metadata_json)
              VALUES (?, ?, ?, 'playtime_reward', ?, ?, 'playtime_interval', ?, ?)
            `).run(
              randomUUID(),
              steamId,
              payoutCoins,
              activeBoostPercent > 0
                ? `Online playtime reward: ${coins} base + ${activeBoostPercent}% quest boost`
                : `Online playtime reward: ${coins} Valley Coin per 5 minutes`,
              key,
              String(sequence),
              JSON.stringify({
                intervalSeconds: 300,
                sequence,
                baseCoins: coins,
                boostPercent: activeBoostPercent,
                bonusCoins,
                payoutCoins,
              })
            );
            coinsAwarded += payoutCoins;
            intervalsAwarded += 1;
          }
          rewardedIntervals = sequence;
        }
        rewardedPlayers += 1;
      }

      db.prepare(`
        INSERT INTO economy_playtime_progress
          (steam_id, last_seen_ms, accrued_ms, rewarded_intervals, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(steam_id) DO UPDATE SET
          last_seen_ms = excluded.last_seen_ms,
          accrued_ms = excluded.accrued_ms,
          rewarded_intervals = excluded.rewarded_intervals,
          updated_at = datetime('now')
      `).run(steamId, Number(nowMs), remainder, rewardedIntervals);
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  return {
    skipped: !payoutsEnabled,
    reason: payoutsEnabled ? null : rewardEnabled ? 'coins-not-configured' : 'disabled',
    onlinePlayers: ids.length,
    trackedPlayers: ids.length,
    rewardedPlayers,
    intervalsAwarded,
    coinsAwarded,
    coinsPer5Minutes: coins,
  };
}

module.exports = {
  enabled,
  coinsPerInterval,
  intervalSeconds,
  maxSampleGapSeconds,
  state,
  rewardOnlinePlayers,
};
