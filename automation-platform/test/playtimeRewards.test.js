const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadRewards() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-rewards-'));
  const previous = {
    db: process.env.AUTOMATION_DB_PATH,
    enabled: process.env.WALLET_PLAYTIME_REWARDS_ENABLED,
    coins: process.env.WALLET_PLAYTIME_COINS_PER_5_MINUTES,
    gap: process.env.WALLET_PLAYTIME_MAX_SAMPLE_GAP_SECONDS,
  };
  process.env.AUTOMATION_DB_PATH = path.join(dir, 'economy.sqlite');
  process.env.WALLET_PLAYTIME_REWARDS_ENABLED = 'true';
  process.env.WALLET_PLAYTIME_COINS_PER_5_MINUTES = '10';
  process.env.WALLET_PLAYTIME_MAX_SAMPLE_GAP_SECONDS = '90';

  const storePath = require.resolve('../src/services/economyStore');
  const rewardsPath = require.resolve('../src/services/playtimeRewardsService');
  delete require.cache[storePath];
  delete require.cache[rewardsPath];
  const store = require(storePath);
  const rewards = require(rewardsPath);

  return {
    store,
    rewards,
    cleanup() {
      delete require.cache[storePath];
      delete require.cache[rewardsPath];
      if (previous.db === undefined) delete process.env.AUTOMATION_DB_PATH; else process.env.AUTOMATION_DB_PATH = previous.db;
      if (previous.enabled === undefined) delete process.env.WALLET_PLAYTIME_REWARDS_ENABLED; else process.env.WALLET_PLAYTIME_REWARDS_ENABLED = previous.enabled;
      if (previous.coins === undefined) delete process.env.WALLET_PLAYTIME_COINS_PER_5_MINUTES; else process.env.WALLET_PLAYTIME_COINS_PER_5_MINUTES = previous.coins;
      if (previous.gap === undefined) delete process.env.WALLET_PLAYTIME_MAX_SAMPLE_GAP_SECONDS; else process.env.WALLET_PLAYTIME_MAX_SAMPLE_GAP_SECONDS = previous.gap;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('player earns configured Valley Coin every five verified minutes', (t) => {
  const fixture = loadRewards();
  t.after(fixture.cleanup);
  const { store, rewards } = fixture;
  const steamId = '76561198000000003';
  const player = [{ steamId }];
  const start = Date.parse('2026-09-18T00:00:00.000Z');

  for (let minute = 0; minute <= 10; minute += 1) {
    rewards.rewardOnlinePlayers(player, { nowMs: start + minute * 60_000 });
  }

  const wallet = store.getWallet(steamId);
  assert.equal(wallet.balance, 20);
  assert.equal(wallet.transactions.length, 2);
  assert.ok(wallet.transactions.every((tx) => tx.kind === 'playtime_reward'));
  assert.equal(rewards.state().coinsPer5Minutes, 10);
  assert.equal(rewards.state().intervalSeconds, 300);
});

test('long offline or RCON gaps are never back-paid', (t) => {
  const fixture = loadRewards();
  t.after(fixture.cleanup);
  const { store, rewards } = fixture;
  const steamId = '76561198000000004';
  const player = [{ steamId }];
  const start = Date.parse('2026-09-18T00:00:00.000Z');

  rewards.rewardOnlinePlayers(player, { nowMs: start });
  rewards.rewardOnlinePlayers(player, { nowMs: start + 60_000 });
  rewards.rewardOnlinePlayers(player, { nowMs: start + 20 * 60_000 });

  assert.equal(store.getWallet(steamId).balance, 0);

  for (let minute = 21; minute <= 25; minute += 1) {
    rewards.rewardOnlinePlayers(player, { nowMs: start + minute * 60_000 });
  }
  assert.equal(store.getWallet(steamId).balance, 10);
});

test('same presence timestamp cannot double-pay a reward interval', (t) => {
  const fixture = loadRewards();
  t.after(fixture.cleanup);
  const { store, rewards } = fixture;
  const steamId = '76561198000000005';
  const player = [{ steamId }];
  const start = Date.parse('2026-09-18T00:00:00.000Z');

  for (let minute = 0; minute <= 5; minute += 1) {
    rewards.rewardOnlinePlayers(player, { nowMs: start + minute * 60_000 });
  }
  rewards.rewardOnlinePlayers(player, { nowMs: start + 5 * 60_000 });

  assert.equal(store.getWallet(steamId).balance, 10);
  assert.equal(store.getWallet(steamId).transactions.length, 1);
});
