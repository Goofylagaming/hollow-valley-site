const test = require('node:test');
const assert = require('node:assert/strict');
const { buildStaffOverview, buildStaffActivityAnalytics } = require('../src/services/herbyBotStaffOverviewService');

test('HerbyBot staff overview strips Steam IDs, location and vitals server-side', () => {
  const result = buildStaffOverview({
    online: true,
    configured: true,
    maxPlayers: 100,
    checkedAt: '2026-09-18T00:00:00.000Z',
    players: [{ steamId: '76561198000000001', name: 'Alpha' }],
    characters: [{
      steamId: '76561198000000001',
      species: 'Carnotaurus',
      growth: 0.4,
      health: 800,
      stamina: 90,
      hunger: 70,
      thirst: 60,
      location: { x: 1, y: 2, z: 3 },
      mutations: ['Example'],
    }],
  }, {
    requests: { pending: 1 },
    outbox: { pending: 2 },
  });

  assert.deepEqual(result.server.players, [{ name: 'Alpha', species: 'Carnotaurus', growth: 0.4 }]);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('76561198000000001'), false);
  assert.equal(serialized.includes('location'), false);
  assert.equal(serialized.includes('health'), false);
  assert.equal(serialized.includes('stamina'), false);
  assert.equal(serialized.includes('mutations'), false);
});


test('HerbyBot activity sanitizer strips Steam IDs and raw trend data', () => {
  const result = buildStaffActivityAnalytics({
    enabled: true,
    hours: 168,
    uniquePlayers: 12,
    returningPlayers: 5,
    sessions: 20,
    trackedMinutes: 900,
    peakConcurrent: 7,
    averageOnline: 2.4,
    averageSessionMinutes: 45,
    medianSessionMinutes: 31,
    longestSessionMinutes: 120,
    sampleCount: 300,
    topPlayers: [{
      steamId: '76561198000000001',
      name: 'Alpha',
      sessions: 4,
      trackedMinutes: 240,
    }],
    topSpecies: [{ species: 'Carnotaurus', samplePlayerCount: 120 }],
    activityTrend: [{ startedAt: '2026-09-18T00:00:00.000Z', averagePlayers: 2 }],
    windowStart: '2026-09-11T00:00:00.000Z',
    windowEnd: '2026-09-18T00:00:00.000Z',
  });

  assert.deepEqual(result.topPlayers, [{ name: 'Alpha', sessions: 4, trackedMinutes: 240 }]);
  assert.deepEqual(result.topSpecies, [{ species: 'Carnotaurus', samplePlayerCount: 120 }]);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('76561198000000001'), false);
  assert.equal(serialized.includes('steamId'), false);
  assert.equal(serialized.includes('activityTrend'), false);
  assert.equal(result.hours, 168);
  assert.equal(result.averageOnline, 2.4);
});
