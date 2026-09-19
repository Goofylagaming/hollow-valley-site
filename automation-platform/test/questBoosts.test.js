const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadQuests() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-quests-'));
  const previous = {
    db: process.env.AUTOMATION_DB_PATH,
    tz: process.env.ECONOMY_TIMEZONE,
    d1: process.env.WALLET_QUEST_DAILY_1H_BOOST_PERCENT,
    d3: process.env.WALLET_QUEST_DAILY_3H_BOOST_PERCENT,
    d6: process.env.WALLET_QUEST_DAILY_6H_BOOST_PERCENT,
    w12: process.env.WALLET_QUEST_WEEKLY_12H_BOOST_PERCENT,
    w24: process.env.WALLET_QUEST_WEEKLY_24H_BOOST_PERCENT,
    cap: process.env.WALLET_QUEST_MAX_TOTAL_BOOST_PERCENT,
  };

  process.env.AUTOMATION_DB_PATH = path.join(dir, 'economy.sqlite');
  process.env.ECONOMY_TIMEZONE = 'Australia/Brisbane';
  process.env.WALLET_QUEST_DAILY_1H_BOOST_PERCENT = '10';
  process.env.WALLET_QUEST_DAILY_3H_BOOST_PERCENT = '15';
  process.env.WALLET_QUEST_DAILY_6H_BOOST_PERCENT = '25';
  process.env.WALLET_QUEST_WEEKLY_12H_BOOST_PERCENT = '10';
  process.env.WALLET_QUEST_WEEKLY_24H_BOOST_PERCENT = '20';
  process.env.WALLET_QUEST_MAX_TOTAL_BOOST_PERCENT = '100';

  const storePath = require.resolve('../src/services/economyStore');
  const questPath = require.resolve('../src/services/questBoostService');
  delete require.cache[storePath];
  delete require.cache[questPath];
  const store = require(storePath);
  const quests = require(questPath);

  return {
    store,
    quests,
    cleanup() {
      delete require.cache[storePath];
      delete require.cache[questPath];
      for (const [key, value] of Object.entries(previous)) {
        const envName = ({
          db: 'AUTOMATION_DB_PATH',
          tz: 'ECONOMY_TIMEZONE',
          d1: 'WALLET_QUEST_DAILY_1H_BOOST_PERCENT',
          d3: 'WALLET_QUEST_DAILY_3H_BOOST_PERCENT',
          d6: 'WALLET_QUEST_DAILY_6H_BOOST_PERCENT',
          w12: 'WALLET_QUEST_WEEKLY_12H_BOOST_PERCENT',
          w24: 'WALLET_QUEST_WEEKLY_24H_BOOST_PERCENT',
          cap: 'WALLET_QUEST_MAX_TOTAL_BOOST_PERCENT',
        })[key];
        if (value === undefined) delete process.env[envName];
        else process.env[envName] = value;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('quest definitions match requested daily and weekly playtime thresholds', (t) => {
  const fixture = loadQuests();
  t.after(fixture.cleanup);
  const defs = fixture.quests.questDefinitions();

  assert.deepEqual(defs.map((quest) => ({
    id: quest.id,
    cadence: quest.cadence,
    metric: quest.metric,
    thresholdSeconds: quest.thresholdSeconds,
  })), [
    { id: 'daily-consecutive-1h', cadence: 'daily', metric: 'consecutive', thresholdSeconds: 3600 },
    { id: 'daily-total-3h', cadence: 'daily', metric: 'total', thresholdSeconds: 10800 },
    { id: 'daily-total-6h', cadence: 'daily', metric: 'total', thresholdSeconds: 21600 },
    { id: 'weekly-total-12h', cadence: 'weekly', metric: 'total', thresholdSeconds: 43200 },
    { id: 'weekly-total-24h', cadence: 'weekly', metric: 'total', thresholdSeconds: 86400 },
  ]);
});

test('daily quests complete automatically and boosts stack additively', (t) => {
  const fixture = loadQuests();
  t.after(fixture.cleanup);
  const { quests } = fixture;
  const steamId = '76561198000000031';
  const now = Date.parse('2026-09-18T02:00:00.000Z');

  let state = quests.updateQuestProgress(steamId, {
    elapsedSeconds: 3600,
    continuous: true,
    nowMs: now,
  });
  assert.equal(state.quests.quests.find((q) => q.id === 'daily-consecutive-1h').completed, true);
  assert.equal(state.quests.activeBoostPercent, 10);

  state = quests.updateQuestProgress(steamId, {
    elapsedSeconds: 7200,
    continuous: true,
    nowMs: now + 7200_000,
  });
  assert.equal(state.quests.quests.find((q) => q.id === 'daily-total-3h').completed, true);
  assert.equal(state.quests.activeBoostPercent, 25);

  state = quests.updateQuestProgress(steamId, {
    elapsedSeconds: 10800,
    continuous: true,
    nowMs: now + 18000_000,
  });
  assert.equal(state.quests.quests.find((q) => q.id === 'daily-total-6h').completed, true);
  assert.equal(state.quests.activeBoostPercent, 50);
});

test('disconnect breaks the one-hour consecutive streak but total daily time continues', (t) => {
  const fixture = loadQuests();
  t.after(fixture.cleanup);
  const { quests } = fixture;
  const steamId = '76561198000000032';
  const now = Date.parse('2026-09-18T02:00:00.000Z');

  quests.updateQuestProgress(steamId, { elapsedSeconds: 1800, continuous: true, nowMs: now });
  let status = quests.updateQuestProgress(steamId, {
    elapsedSeconds: 0,
    continuous: false,
    nowMs: now + 40 * 60_000,
  }).quests;

  const streak = status.quests.find((q) => q.id === 'daily-consecutive-1h');
  const total3h = status.quests.find((q) => q.id === 'daily-total-3h');
  assert.equal(streak.progressSeconds, 0);
  assert.equal(total3h.progressSeconds, 1800);

  status = quests.updateQuestProgress(steamId, {
    elapsedSeconds: 1800,
    continuous: true,
    nowMs: now + 70 * 60_000,
  }).quests;
  assert.equal(status.quests.find((q) => q.id === 'daily-consecutive-1h').progressSeconds, 1800);
  assert.equal(status.quests.find((q) => q.id === 'daily-total-3h').progressSeconds, 3600);
});

test('daily boosts reset on the next Brisbane day while weekly progress remains', (t) => {
  const fixture = loadQuests();
  t.after(fixture.cleanup);
  const { quests } = fixture;
  const steamId = '76561198000000033';

  const dayOne = Date.parse('2026-09-18T02:00:00.000Z');
  quests.updateQuestProgress(steamId, { elapsedSeconds: 3600, continuous: true, nowMs: dayOne });
  let status = quests.getQuestStatus(steamId, { nowMs: dayOne });
  assert.equal(status.activeBoostPercent, 10);

  const nextBrisbaneDay = Date.parse('2026-09-19T02:00:00.000Z');
  status = quests.getQuestStatus(steamId, { nowMs: nextBrisbaneDay });
  assert.equal(status.activeBoostPercent, 0);
  assert.equal(status.quests.find((q) => q.id === 'daily-consecutive-1h').completed, false);
});

test('weekly 12h and 24h achievements stack with daily achievements', (t) => {
  const fixture = loadQuests();
  t.after(fixture.cleanup);
  const { quests } = fixture;
  const steamId = '76561198000000034';
  const now = Date.parse('2026-09-18T02:00:00.000Z');

  quests.updateQuestProgress(steamId, { elapsedSeconds: 43200, continuous: true, nowMs: now });
  let status = quests.getQuestStatus(steamId, { nowMs: now });
  assert.equal(status.quests.find((q) => q.id === 'weekly-total-12h').completed, true);
  assert.equal(status.activeBoostPercent, 60);

  quests.updateQuestProgress(steamId, { elapsedSeconds: 43200, continuous: true, nowMs: now + 60_000 });
  status = quests.getQuestStatus(steamId, { nowMs: now + 60_000 });
  assert.equal(status.quests.find((q) => q.id === 'weekly-total-24h').completed, true);
  assert.equal(status.activeBoostPercent, 80);
});

test('configured total boost cap limits stacked boosts', (t) => {
  const fixture = loadQuests();
  t.after(fixture.cleanup);
  process.env.WALLET_QUEST_MAX_TOTAL_BOOST_PERCENT = '30';
  const { quests } = fixture;
  const steamId = '76561198000000035';
  const now = Date.parse('2026-09-18T02:00:00.000Z');

  quests.updateQuestProgress(steamId, { elapsedSeconds: 21600, continuous: true, nowMs: now });
  const status = quests.getQuestStatus(steamId, { nowMs: now });
  assert.equal(status.quests.filter((q) => q.completed).length >= 3, true);
  assert.equal(status.activeBoostPercent, 30);
});
