const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-event-rewards-'));
const dbPath = path.join(dir, 'automation.sqlite');

const previous = {
  AUTOMATION_DB_PATH: process.env.AUTOMATION_DB_PATH,
  EVENT_REWARDS_ENABLED: process.env.EVENT_REWARDS_ENABLED,
  SUPPORTER_COIN_BONUSES_ENABLED: process.env.SUPPORTER_COIN_BONUSES_ENABLED,
  HOLLOW_VALLEY_API_BASE_URL: process.env.HOLLOW_VALLEY_API_BASE_URL,
  HOLLOW_VALLEY_API_TOKEN: process.env.HOLLOW_VALLEY_API_TOKEN,
};

process.env.AUTOMATION_DB_PATH = dbPath;
process.env.EVENT_REWARDS_ENABLED = 'true';
process.env.SUPPORTER_COIN_BONUSES_ENABLED = 'false';

const economy = require('../src/services/economyStore');
const supporter = require('../src/services/supporterBonusService');
const rewards = require('../src/services/eventRewardService');

test.after(() => {
  supporter._test.clearCache();
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('event reward gate fails closed when disabled', async () => {
  const env = { ...process.env, EVENT_REWARDS_ENABLED: 'false' };
  await assert.rejects(
    rewards.awardReward({
      steamId: '76561198000000401',
      eventId: 'event-disabled',
      eventTitle: 'Disabled Event',
      baseAmount: 100,
    }, { env }),
    (error) => error.code === 'EVENT_REWARDS_DISABLED'
  );
});

test('standard event reward credits once and remains idempotent even if amount later changes', async () => {
  const steamId = '76561198000000402';
  const env = {
    ...process.env,
    EVENT_REWARDS_ENABLED: 'true',
    SUPPORTER_COIN_BONUSES_ENABLED: 'false',
  };

  const first = await rewards.awardReward({
    steamId,
    eventId: 'migration-night-01',
    eventTitle: 'Migration Night',
    baseAmount: 250,
  }, { env });

  assert.equal(first.duplicate, false);
  assert.equal(first.baseAmount, 250);
  assert.equal(first.supporterMultiplier, 1);
  assert.equal(first.payoutAmount, 250);
  assert.equal(first.wallet.balance, 250);
  assert.equal(first.transaction.kind, 'event_reward');
  assert.equal(first.transaction.metadata.eventTitle, 'Migration Night');

  const duplicate = await rewards.awardReward({
    steamId,
    eventId: 'migration-night-01',
    eventTitle: 'Migration Night Renamed',
    baseAmount: 999,
  }, { env });

  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.baseAmount, 250);
  assert.equal(duplicate.payoutAmount, 250);
  assert.equal(duplicate.wallet.balance, 250);
  assert.equal(rewards.listRewards({ steamId }).length, 1);
});

test('official supporter multiplier applies to eligible event rewards', async (t) => {
  const steamId = '76561198000000403';
  const env = {
    ...process.env,
    EVENT_REWARDS_ENABLED: 'true',
    SUPPORTER_COIN_BONUSES_ENABLED: 'true',
    HOLLOW_VALLEY_API_BASE_URL: 'https://example.test',
    HOLLOW_VALLEY_API_TOKEN: 'test-token',
  };

  const originalRefresh = supporter.refreshMemberships;
  supporter.refreshMemberships = async (ids, { env: suppliedEnv }) => {
    supporter.replaceMemberships(ids, [
      { steamId, entitled: true, tier: 'guardian' },
    ], suppliedEnv);
    return { skipped: false, requested: 1, entitled: 1 };
  };
  t.after(() => { supporter.refreshMemberships = originalRefresh; supporter._test.clearCache(); });

  const result = await rewards.awardReward({
    steamId,
    eventId: 'hunt-night-01',
    eventTitle: 'Hunt Night',
    baseAmount: 200,
  }, { env });

  assert.equal(result.supporterTier, 'guardian');
  assert.equal(result.supporterMultiplier, 3);
  assert.equal(result.supporterBonusCoins, 400);
  assert.equal(result.payoutAmount, 600);
  assert.equal(result.wallet.balance, 600);
  assert.equal(result.transaction.metadata.baseAmount, 200);
  assert.equal(result.transaction.metadata.supporterMultiplier, 3);
  assert.equal(result.transaction.metadata.payoutAmount, 600);
});

test('supporter lookup failure prevents a manual event payout instead of underpaying it', async (t) => {
  const steamId = '76561198000000404';
  const env = {
    ...process.env,
    EVENT_REWARDS_ENABLED: 'true',
    SUPPORTER_COIN_BONUSES_ENABLED: 'true',
    HOLLOW_VALLEY_API_BASE_URL: 'https://example.test',
    HOLLOW_VALLEY_API_TOKEN: 'test-token',
  };

  const originalRefresh = supporter.refreshMemberships;
  supporter.refreshMemberships = async () => { throw new Error('lookup down'); };
  t.after(() => { supporter.refreshMemberships = originalRefresh; supporter._test.clearCache(); });

  await assert.rejects(
    rewards.awardReward({
      steamId,
      eventId: 'event-lookup-fail',
      eventTitle: 'Lookup Failure Event',
      baseAmount: 300,
    }, { env }),
    (error) => error.code === 'EVENT_REWARD_SUPPORTER_LOOKUP_FAILED'
  );

  assert.equal(economy.getWallet(steamId).balance, 0);
  assert.equal(rewards.listRewards({ steamId }).length, 0);
});

test('malformed prototype-like supporter tiers are not accepted', () => {
  assert.equal(supporter.normalizeTier('__proto__'), null);
  assert.equal(supporter.normalizeTier('constructor'), null);
});
