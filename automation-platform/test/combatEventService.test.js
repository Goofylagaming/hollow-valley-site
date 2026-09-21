const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadService(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-combat-service-'));
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
    eventId: 'death-event-0001',
    occurredAt: '2026-09-21T08:00:00.000Z',
    killerSteamId: '76561198000001001',
    killerName: 'Hunter',
    victimSteamId: '76561198000001002',
    victimName: 'Grazer',
    ...overrides,
  };
}

test('combat ingestion is disabled unless explicitly enabled', (t) => {
  const service = loadService(t);
  process.env.COMBAT_FEED_ENABLED = 'false';

  assert.throws(
    () => service.ingestEvent(event()),
    (error) => error.code === 'COMBAT_FEED_DISABLED'
  );
  assert.equal(service._test.db.prepare('SELECT COUNT(*) AS n FROM combat_events').get().n, 0);
});

test('combat events are idempotent and conflicting duplicate IDs fail closed', (t) => {
  const service = loadService(t);

  const first = service.ingestEvent(event());
  assert.equal(first.duplicate, false);

  const duplicate = service.ingestEvent(event());
  assert.equal(duplicate.duplicate, true);
  assert.equal(service._test.db.prepare('SELECT COUNT(*) AS n FROM combat_events').get().n, 1);

  assert.throws(
    () => service.ingestEvent(event({ victimSteamId: '76561198000001003', victimName: 'Different' })),
    (error) => error.code === 'COMBAT_EVENT_CONFLICT'
  );
  assert.equal(service._test.db.prepare('SELECT COUNT(*) AS n FROM combat_events').get().n, 1);
});

test('verified leaderboard derives kills, deaths and K:D without inventing environmental kills', (t) => {
  const service = loadService(t);

  service.ingestEvent(event({ eventId: 'death-event-1001' }));
  service.ingestEvent(event({
    eventId: 'death-event-1002',
    occurredAt: '2026-09-21T08:01:00.000Z',
    victimSteamId: '76561198000001003',
    victimName: 'Runner',
  }));
  service.ingestEvent(event({
    eventId: 'death-event-1003',
    occurredAt: '2026-09-21T08:02:00.000Z',
    killerSteamId: null,
    killerName: null,
    victimSteamId: '76561198000001001',
    victimName: 'Hunter',
  }));
  service.ingestEvent(event({
    eventId: 'death-event-1004',
    occurredAt: '2026-09-21T08:03:00.000Z',
    killerSteamId: '76561198000001002',
    killerName: 'Grazer',
    victimSteamId: '76561198000001001',
    victimName: 'Hunter',
  }));

  const board = service.leaderboard({
    hours: 24 * 31,
    nowMs: Date.parse('2026-09-21T09:00:00.000Z'),
  });

  assert.equal(board.eventCount, 4);
  assert.equal(board.mostKills[0].username, 'Hunter');
  assert.equal(board.mostKills[0].kills, 2);
  assert.equal(board.mostKills[0].deaths, 2);
  assert.equal(board.mostKills[0].kd, 1);

  const grazer = board.bestKd.find((row) => row.username === 'Grazer');
  assert.equal(grazer.kills, 1);
  assert.equal(grazer.deaths, 1);
  assert.equal(grazer.kd, 1);

  const totalKills = board.mostKills.reduce((sum, row) => sum + row.kills, 0);
  assert.equal(totalKills, 3);
});
