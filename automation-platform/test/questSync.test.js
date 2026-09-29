const test = require('node:test');
const assert = require('node:assert/strict');
process.env.AUTOMATION_DB_PATH = ':memory:';
process.env.WALLET_PLAYTIME_REWARDS_ENABLED = 'true';
process.env.WALLET_PLAYTIME_COINS_PER_5_MINUTES = '10';
process.env.WALLET_PLAYTIME_MAX_SAMPLE_GAP_SECONDS = '90';
process.env.SUPPORTER_COIN_BONUSES_ENABLED = 'false';
delete process.env.QUEST_MAX_SAMPLE_GAP_SECONDS;
const rewards = require('../src/services/playtimeRewardsService');
const store = require('../src/services/economyStore');
const start = Date.parse('2026-09-29T00:00:00Z');

test('five-minute RCON samples advance quests without widening wallet payout gaps', () => {
  const steamId = '76561198000000801';
  for (let i = 0; i <= 12; i++) {
    rewards.rewardOnlinePlayers([{ steamId }], { nowMs: start + i * 300000, expectedIntervalMs: 300000 });
  }
  assert.equal(store.getQuestState(steamId).daily_total_seconds, 3600);
  assert.equal(store.getQuestState(steamId).daily_streak_seconds, 3600);
  assert.equal(store.getWallet(steamId).balance, 0);
  assert.equal(rewards.questMaxSampleGapSeconds(300000), 330);
  assert.equal(rewards.questMaxSampleGapSeconds(600000), 630);
});

test('external feed keeps 90-second policy; explicit quest tolerance does not alter coin policy', () => {
  const steamId = '76561198000000802';
  const sample = (seconds) => rewards.rewardOnlinePlayers([{ steamId }], { nowMs: start + seconds * 1000 });
  sample(0); sample(60); sample(180);
  assert.equal(store.getQuestState(steamId).daily_total_seconds, 60);
  assert.equal(store.getQuestState(steamId).daily_streak_seconds, 0);
  process.env.QUEST_MAX_SAMPLE_GAP_SECONDS = '150';
  try {
    sample(300);
    assert.equal(store.getQuestState(steamId).daily_total_seconds, 180);
    assert.equal(store.getQuestState(steamId).daily_streak_seconds, 120);
    assert.equal(store.getPlaytimeProgress(steamId).accrued_ms, 60000);
    sample(451);
    assert.equal(store.getQuestState(steamId).daily_total_seconds, 180);
    assert.equal(store.getQuestState(steamId).daily_streak_seconds, 0);
  } finally { delete process.env.QUEST_MAX_SAMPLE_GAP_SECONDS; }
});

test('duplicate and out-of-order observations preserve streak and checkpoint', () => {
  const steamId = '76561198000000803';
  const sample = (seconds) => rewards.rewardOnlinePlayers([{ steamId }], { nowMs: start + seconds * 1000 });
  sample(0); sample(60); sample(60); sample(30);
  assert.equal(store.getQuestState(steamId).daily_streak_seconds, 60);
  assert.equal(store.getPlaytimeProgress(steamId).last_seen_ms, start + 60000);
  sample(120);
  assert.equal(store.getQuestState(steamId).daily_total_seconds, 120);
});

test('RCON quest gaps beyond one interval plus jitter are not backfilled', () => {
  const steamId = '76561198000000804';
  for (const seconds of [0, 310, 910]) {
    rewards.rewardOnlinePlayers([{ steamId }], { nowMs: start + seconds * 1000, expectedIntervalMs: 300000 });
  }
  assert.equal(store.getQuestState(steamId).daily_total_seconds, 310);
  assert.equal(store.getQuestState(steamId).daily_streak_seconds, 0);
});
