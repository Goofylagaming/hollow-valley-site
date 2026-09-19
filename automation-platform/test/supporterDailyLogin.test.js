const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('daily login reward applies official supporter multiplier and remains idempotent', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-supporter-daily-'));
  const names = [
    'AUTOMATION_DB_PATH',
    'WALLET_DAILY_LOGIN_BONUS_ENABLED',
    'WALLET_DAILY_LOGIN_BONUS_COINS',
    'SUPPORTER_COIN_BONUSES_ENABLED',
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));

  process.env.AUTOMATION_DB_PATH = path.join(dir, 'economy.sqlite');
  process.env.WALLET_DAILY_LOGIN_BONUS_ENABLED = 'true';
  process.env.WALLET_DAILY_LOGIN_BONUS_COINS = '200';
  process.env.SUPPORTER_COIN_BONUSES_ENABLED = 'true';

  const modules = [
    '../src/services/economyStore',
    '../src/services/supporterBonusService',
    '../src/services/dailyLoginBonusService',
  ].map(require.resolve);
  for (const modulePath of modules) delete require.cache[modulePath];

  const supporter = require('../src/services/supporterBonusService');
  const daily = require('../src/services/dailyLoginBonusService');

  t.after(() => {
    supporter._test.clearCache();
    for (const modulePath of modules) delete require.cache[modulePath];
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const steamId = '76561198000000077';
  supporter.refreshMemberships = async (ids) => {
    supporter.replaceMemberships(ids, [{ steamId, entitled: true, tier: 'supporter' }]);
    return { skipped: false, requested: 1, entitled: 1 };
  };

  const now = new Date('2026-09-19T02:00:00.000Z');
  const first = await daily.claim(steamId, { now });
  assert.equal(first.baseAmount, 200);
  assert.equal(first.supporterTier, 'supporter');
  assert.equal(first.supporterMultiplier, 2);
  assert.equal(first.amount, 400);
  assert.equal(first.wallet.balance, 400);
  assert.equal(first.transaction.metadata.baseAmount, 200);
  assert.equal(first.transaction.metadata.supporterMultiplier, 2);

  const duplicate = await daily.claim(steamId, { now });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.wallet.balance, 400);
});
