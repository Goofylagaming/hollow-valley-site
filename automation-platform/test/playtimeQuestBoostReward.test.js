const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadRewardFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-reward-boost-'));
  const names = [
    'AUTOMATION_DB_PATH',
    'WALLET_PLAYTIME_REWARDS_ENABLED',
    'WALLET_PLAYTIME_COINS_PER_5_MINUTES',
    'WALLET_PLAYTIME_MAX_SAMPLE_GAP_SECONDS',
    'WALLET_QUEST_DAILY_1H_BOOST_PERCENT',
    'WALLET_QUEST_DAILY_3H_BOOST_PERCENT',
    'WALLET_QUEST_DAILY_6H_BOOST_PERCENT',
    'WALLET_QUEST_WEEKLY_12H_BOOST_PERCENT',
    'WALLET_QUEST_WEEKLY_24H_BOOST_PERCENT',
    'WALLET_QUEST_MAX_TOTAL_BOOST_PERCENT',
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));

  process.env.AUTOMATION_DB_PATH = path.join(dir, 'economy.sqlite');
  process.env.WALLET_PLAYTIME_REWARDS_ENABLED = 'true';
  process.env.WALLET_PLAYTIME_COINS_PER_5_MINUTES = '20';
  process.env.WALLET_PLAYTIME_MAX_SAMPLE_GAP_SECONDS = '90';
  process.env.WALLET_QUEST_DAILY_1H_BOOST_PERCENT = '25';
  process.env.WALLET_QUEST_DAILY_3H_BOOST_PERCENT = '0';
  process.env.WALLET_QUEST_DAILY_6H_BOOST_PERCENT = '0';
  process.env.WALLET_QUEST_WEEKLY_12H_BOOST_PERCENT = '0';
  process.env.WALLET_QUEST_WEEKLY_24H_BOOST_PERCENT = '0';
  process.env.WALLET_QUEST_MAX_TOTAL_BOOST_PERCENT = '100';

  const paths = [
    require.resolve('../src/services/economyStore'),
    require.resolve('../src/services/questBoostService'),
    require.resolve('../src/services/playtimeRewardsService'),
  ];
  for (const p of paths) delete require.cache[p];

  const store = require('../src/services/economyStore');
  const quests = require('../src/services/questBoostService');
  const rewards = require('../src/services/playtimeRewardsService');

  return {
    store,
    quests,
    rewards,
    cleanup() {
      for (const p of paths) delete require.cache[p];
      for (const name of names) {
        if (previous[name] === undefined) delete process.env[name];
        else process.env[name] = previous[name];
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('completed quest boost increases future five-minute Valley Coin payout', (t) => {
  const fixture = loadRewardFixture();
  t.after(fixture.cleanup);
  const { store, quests, rewards } = fixture;
  const steamId = '76561198000000036';
  const player = [{ steamId }];
  const start = Date.parse('2026-09-18T00:00:00.000Z');

  rewards.rewardOnlinePlayers(player, { nowMs: start });
  quests.updateQuestProgress(steamId, {
    elapsedSeconds: 3600,
    continuous: true,
    nowMs: start + 3600_000,
  });

  // Re-establish the verified presence clock after the deliberate test jump.
  rewards.rewardOnlinePlayers(player, { nowMs: start + 3600_000 });
  for (let minute = 61; minute <= 65; minute += 1) {
    rewards.rewardOnlinePlayers(player, { nowMs: start + minute * 60_000 });
  }

  const wallet = store.getWallet(steamId);
  assert.equal(wallet.balance, 25);
  assert.equal(wallet.transactions.length, 1);
  assert.equal(wallet.transactions[0].amount, 25);
  assert.equal(wallet.transactions[0].metadata.baseCoins, 20);
  assert.equal(wallet.transactions[0].metadata.boostPercent, 25);
  assert.equal(wallet.transactions[0].metadata.bonusCoins, 5);
});
