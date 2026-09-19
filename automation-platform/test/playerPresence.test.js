const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadPresence({ snapshot, enabled = true } = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-presence-'));
  const dbPath = path.join(tempDir, 'presence.sqlite');
  const previousDb = process.env.AUTOMATION_DB_PATH;
  const previousEnabled = process.env.PLAYER_PRESENCE_ENABLED;
  process.env.AUTOMATION_DB_PATH = dbPath;
  process.env.PLAYER_PRESENCE_ENABLED = enabled ? 'true' : 'false';

  const statusPath = require.resolve('../src/services/statusService');
  const presencePath = require.resolve('../src/services/playerPresenceService');
  const originalStatus = require(statusPath);
  require.cache[statusPath].exports = {
    ...originalStatus,
    getServerSnapshot: async () => snapshot,
  };
  delete require.cache[presencePath];
  const presence = require(presencePath);

  return {
    presence,
    cleanup() {
      require.cache[statusPath].exports = originalStatus;
      delete require.cache[presencePath];
      if (previousDb === undefined) delete process.env.AUTOMATION_DB_PATH;
      else process.env.AUTOMATION_DB_PATH = previousDb;
      if (previousEnabled === undefined) delete process.env.PLAYER_PRESENCE_ENABLED;
      else process.env.PLAYER_PRESENCE_ENABLED = previousEnabled;
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

test('presence reconciliation opens, updates and closes sessions from successful snapshots', (t) => {
  const fixture = loadPresence({ snapshot: { configured: true, online: true, players: [], characters: [] } });
  t.after(fixture.cleanup);
  const p = fixture.presence;

  const first = p.reconcilePresence([
    { steamId: '76561198000000000', name: 'Alpha', species: 'Triceratops' },
    { steamId: '76561198000000001', name: 'Beta', species: 'Utahraptor' },
  ], '2026-09-18T00:00:00.000Z');
  assert.deepEqual(first, { opened: 2, updated: 0, closed: 0, online: 2 });

  const second = p.reconcilePresence([
    { steamId: '76561198000000000', name: 'Alpha', species: 'Triceratops' },
  ], '2026-09-18T00:01:00.000Z');
  assert.deepEqual(second, { opened: 0, updated: 1, closed: 1, online: 1 });

  const active = p.listSessions({ activeOnly: true });
  assert.equal(active.length, 1);
  assert.equal(active[0].steam_id, '76561198000000000');

  const all = p.listSessions({ limit: 10 });
  assert.equal(all.length, 2);
  assert.ok(all.some((row) => row.steam_id === '76561198000000001' && row.ended_at));
});

test('RCON outage skips reconciliation and leaves open sessions intact', async (t) => {
  const fixture = loadPresence({
    snapshot: { configured: true, online: false, players: [], characters: [], error: 'RCON timeout' },
  });
  t.after(fixture.cleanup);
  const p = fixture.presence;

  p.reconcilePresence([
    { steamId: '76561198000000000', name: 'Alpha', species: 'Triceratops' },
  ], '2026-09-18T00:00:00.000Z');

  const result = await p.samplePresence({ force: true });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'rcon-unavailable');
  assert.equal(p.listSessions({ activeOnly: true }).length, 1);
});

test('presence normalizes player list and character species without exposing locations', (t) => {
  const fixture = loadPresence({ snapshot: { configured: true, online: true, players: [], characters: [] } });
  t.after(fixture.cleanup);
  const p = fixture.presence;

  const result = p.normalizeOnline({
    players: [{ steamId: '76561198000000000', name: 'Alpha' }],
    characters: [{ steamId: '76561198000000000', species: 'Triceratops', location: { x: 1, y: 2, z: 3 } }],
  });
  assert.deepEqual(result, [{ steamId: '76561198000000000', name: 'Alpha', species: 'Triceratops' }]);
});


test('join-message helpers identify only newly opened sessions and safely build the welcome text', (t) => {
  const fixture = loadPresence({ snapshot: { configured: true, online: true, players: [], characters: [] } });
  t.after(fixture.cleanup);
  const p = fixture.presence;

  const alpha = { steamId: '76561198000000000', name: 'Alpha', species: 'Triceratops' };
  const beta = { steamId: '76561198000000001', name: 'Beta', species: 'Omniraptor' };

  assert.deepEqual(p.findNewPlayers([alpha, beta]).map((player) => player.name), ['Alpha', 'Beta']);
  p.reconcilePresence([alpha], '2026-09-18T00:00:00.000Z');
  assert.deepEqual(p.findNewPlayers([alpha, beta]).map((player) => player.name), ['Beta']);

  const previousTemplate = process.env.JOIN_MESSAGE_TEMPLATE;
  process.env.JOIN_MESSAGE_TEMPLATE = 'Welcome {player} to Hollow Valley!';
  assert.equal(p.buildJoinMessage({ name: 'Beta' }), 'Welcome Beta to Hollow Valley!');
  assert.equal(p.buildJoinMessage({ name: 'Bad\nName' }), 'Welcome BadName to Hollow Valley!');
  if (previousTemplate === undefined) delete process.env.JOIN_MESSAGE_TEMPLATE;
  else process.env.JOIN_MESSAGE_TEMPLATE = previousTemplate;
});

test('presence analytics calculate unique players, tracked time and peak concurrency', (t) => {
  const fixture = loadPresence({ snapshot: { configured: true, online: true, players: [], characters: [] } });
  t.after(fixture.cleanup);
  const p = fixture.presence;

  p.reconcilePresence([
    { steamId: '76561198000000000', name: 'Alpha', species: 'Triceratops' },
  ], '2026-09-18T00:00:00.000Z');
  p.reconcilePresence([
    { steamId: '76561198000000000', name: 'Alpha', species: 'Triceratops' },
    { steamId: '76561198000000001', name: 'Beta', species: 'Utahraptor' },
  ], '2026-09-18T00:30:00.000Z');
  p.reconcilePresence([
    { steamId: '76561198000000001', name: 'Beta', species: 'Utahraptor' },
  ], '2026-09-18T01:00:00.000Z');
  p.reconcilePresence([], '2026-09-18T01:30:00.000Z');

  const analytics = p.getPresenceAnalytics({
    hours: 24,
    nowMs: Date.parse('2026-09-18T02:00:00.000Z'),
  });

  assert.equal(analytics.uniquePlayers, 2);
  assert.equal(analytics.sessions, 2);
  assert.equal(analytics.trackedMinutes, 120);
  assert.equal(analytics.peakConcurrent, 2);
  assert.equal(analytics.topPlayers.length, 2);
  assert.equal(analytics.topPlayers[0].trackedMinutes, 60);
});


test('aggregate presence samples drive activity averages, species mix and bucketed trends', (t) => {
  const fixture = loadPresence({ snapshot: { configured: true, online: true, players: [], characters: [] } });
  t.after(fixture.cleanup);
  const p = fixture.presence;

  const alpha = { steamId: '76561198000000000', name: 'Alpha', species: 'Triceratops' };
  const beta = { steamId: '76561198000000001', name: 'Beta', species: 'Omniraptor' };

  p.reconcilePresence([alpha, beta], '2026-09-18T00:00:00.000Z');
  p.recordPresenceSample([alpha, beta], '2026-09-18T00:00:00.000Z');

  p.reconcilePresence([beta], '2026-09-18T00:30:00.000Z');
  p.recordPresenceSample([beta], '2026-09-18T00:30:00.000Z');

  p.reconcilePresence([alpha], '2026-09-18T01:00:00.000Z');
  p.recordPresenceSample([alpha], '2026-09-18T01:00:00.000Z');

  p.reconcilePresence([], '2026-09-18T01:30:00.000Z');
  p.recordPresenceSample([], '2026-09-18T01:30:00.000Z');

  const analytics = p.getPresenceAnalytics({
    hours: 24,
    nowMs: Date.parse('2026-09-18T02:00:00.000Z'),
  });

  assert.equal(analytics.uniquePlayers, 2);
  assert.equal(analytics.sessions, 3);
  assert.equal(analytics.returningPlayers, 1);
  assert.equal(analytics.trackedMinutes, 120);
  assert.equal(analytics.averageSessionMinutes, 40);
  assert.equal(analytics.medianSessionMinutes, 30);
  assert.equal(analytics.longestSessionMinutes, 60);
  assert.equal(analytics.peakConcurrent, 2);
  assert.equal(analytics.averageOnline, 1);
  assert.equal(analytics.sampleCount, 4);
  assert.ok(analytics.activityTrend.length >= 1);
  assert.ok(analytics.activityTrend.length <= 48);
  assert.ok(analytics.activityTrend.every((point) => Object.hasOwn(point, 'averagePlayers') && Object.hasOwn(point, 'peakPlayers')));
  assert.deepEqual(analytics.topSpecies.slice(0, 2), [
    { species: 'Omniraptor', samplePlayerCount: 2 },
    { species: 'Triceratops', samplePlayerCount: 2 },
  ]);
});

test('presence sample retention prunes old aggregate samples without touching sessions', (t) => {
  const fixture = loadPresence({ snapshot: { configured: true, online: true, players: [], characters: [] } });
  t.after(fixture.cleanup);
  const p = fixture.presence;

  const alpha = { steamId: '76561198000000000', name: 'Alpha', species: 'Triceratops' };
  p.reconcilePresence([alpha], '2026-09-17T01:00:00.000Z');
  p.recordPresenceSample([alpha], '2026-09-17T01:00:00.000Z');
  p.recordPresenceSample([alpha], '2026-09-17T13:00:00.000Z');

  const removed = p.prunePresenceSamples({
    retentionHours: 24,
    nowIso: '2026-09-18T12:00:00.000Z',
  });

  assert.equal(removed, 1);
  const samples = p.listPresenceSamples({
    hours: 48,
    nowMs: Date.parse('2026-09-18T12:00:00.000Z'),
  });
  assert.equal(samples.length, 1);
  assert.equal(samples[0].sampledAt, '2026-09-17T13:00:00.000Z');
  assert.equal(p.listSessions({ limit: 10 }).length, 1);
});

test('activity trend buckets many raw samples into a bounded response', (t) => {
  const fixture = loadPresence({ snapshot: { configured: true, online: true, players: [], characters: [] } });
  t.after(fixture.cleanup);
  const p = fixture.presence;

  const start = Date.parse('2026-09-18T00:00:00.000Z');
  const samples = Array.from({ length: 120 }, (_, index) => ({
    sampledAt: new Date(start + index * 60_000).toISOString(),
    playerCount: index % 10,
    speciesCounts: {},
  }));
  const trend = p.buildActivityTrend(samples, {
    startMs: start,
    endMs: start + 120 * 60_000,
    maxBuckets: 24,
  });

  assert.ok(trend.length <= 24);
  assert.ok(trend.length > 0);
  assert.ok(trend.some((point) => point.peakPlayers > 0));
});
