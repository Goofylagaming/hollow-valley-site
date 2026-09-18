const test = require('node:test');
const assert = require('node:assert/strict');
const { buildStaffOverview } = require('../src/services/herbyBotStaffOverviewService');

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
