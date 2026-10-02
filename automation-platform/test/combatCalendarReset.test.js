const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadService(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-combat-calendar-'));
  const oldDbPath = process.env.AUTOMATION_DB_PATH;
  const oldEnabled = process.env.COMBAT_FEED_ENABLED;
  const oldToken = process.env.COMBAT_FEED_TOKEN;
  const oldSource = process.env.COMBAT_FEED_SOURCE;

  process.env.AUTOMATION_DB_PATH = path.join(dir, 'automation.sqlite');
  process.env.COMBAT_FEED_ENABLED = 'true';
  process.env.COMBAT_FEED_TOKEN = 'combat-feed-test-token-1234567890';
  process.env.COMBAT_FEED_SOURCE = 'test-game';

  const modulePath = require.resolve('../src/services/combatEventService');
  delete require.cache[modulePath];
  const service = require(modulePath);

  t.after(() => {
    delete require.cache[modulePath];
    if (oldDbPath === undefined) delete process.env.AUTOMATION_DB_PATH; else process.env.AUTOMATION_DB_PATH = oldDbPath;
    if (oldEnabled === undefined) delete process.env.COMBAT_FEED_ENABLED; else process.env.COMBAT_FEED_ENABLED = oldEnabled;
    if (oldToken === undefined) delete process.env.COMBAT_FEED_TOKEN; else process.env.COMBAT_FEED_TOKEN = oldToken;
    if (oldSource === undefined) delete process.env.COMBAT_FEED_SOURCE; else process.env.COMBAT_FEED_SOURCE = oldSource;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  return service;
}

function event(overrides = {}) {
  return {
    eventId: 'calendar-event-0001',
    occurredAt: '2026-10-03T00:00:00.000Z',
    killerSteamId: '76561198000001001',
    killerName: 'Hunter',
    victimSteamId: '76561198000001002',
    victimName: 'Grazer',
    ...overrides,
  };
}

test('Brisbane daily and weekly windows use calendar boundaries', (t) => {
  const service = loadService(t);
  const nowMs = Date.parse('2026-10-03T02:00:00.000Z'); // Saturday 12:00 Brisbane

  const daily = service.brisbaneCalendarWindow('daily', nowMs);
  assert.equal(daily.start, '2026-10-02T14:00:00.000Z');
  assert.equal(daily.end, '2026-10-03T02:00:00.000Z');

  const weekly = service.brisbaneCalendarWindow('weekly', nowMs);
  assert.equal(weekly.start, '2026-09-27T14:00:00.000Z'); // Monday 00:00 Brisbane
  assert.equal(weekly.end, '2026-10-03T02:00:00.000Z');
});

test('player reset starts only that player from zero without deleting shared combat history', (t) => {
  const service = loadService(t);

  service.ingestEvent(event({
    eventId: 'calendar-event-1001',
    occurredAt: '2026-10-03T00:00:00.000Z',
  }));

  const reset = service.resetPlayerStats('76561198000001001', {
    resetAt: '2026-10-03T00:05:00.000Z',
    reason: 'Test reset',
  });
  assert.equal(reset.steamId, '76561198000001001');
  assert.equal(reset.resetAt, '2026-10-03T00:05:00.000Z');

  service.ingestEvent(event({
    eventId: 'calendar-event-1002',
    occurredAt: '2026-10-03T00:10:00.000Z',
    victimSteamId: '76561198000001003',
    victimName: 'Runner',
  }));

  const board = service.leaderboard({
    period: 'daily',
    nowMs: Date.parse('2026-10-03T01:00:00.000Z'),
  });

  const hunter = board.mostKills.find((row) => row.steamId === '76561198000001001');
  assert.equal(hunter.kills, 1);

  const grazer = board.mostDeaths.find((row) => row.steamId === '76561198000001002');
  assert.equal(grazer.deaths, 1);

  assert.equal(service._test.db.prepare('SELECT COUNT(*) AS n FROM combat_events').get().n, 2);
});
