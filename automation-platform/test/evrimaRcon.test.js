const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePlayerData } = require('../src/adapters/evrimaRcon');

test('parsePlayerData preserves live character fields used by automation', () => {
  const response = [
    'Name: Raptor One, PlayerID: 76561198000000001, Gender: Female, Class: Omniraptor, Growth: 0.42, Health: 85, Stamina: 70, Hunger: 55, Thirst: 44, PrimeElder: true, MutationSlots: [1=StrongLegs,2=None,3=EfficientDigestion], Location: X=123.5 Y=-456.25 Z=78',
    'PlayerDataEnd',
  ].join('\n');

  assert.deepEqual(parsePlayerData(response), [{
    steamId: '76561198000000001',
    name: 'Raptor One',
    gender: 'Female',
    species: 'Omniraptor',
    growth: 0.42,
    health: 85,
    stamina: 70,
    hunger: 55,
    thirst: 44,
    isPrime: true,
    mutations: ['StrongLegs', 'EfficientDigestion'],
    location: { x: 123.5, y: -456.25, z: 78 },
  }]);
});

test('parsePlayerData keeps missing supplementary fields safe', () => {
  const response = 'Name: Test, PlayerID: 76561198000000002, Class: Dryosaurus, Growth: 1\nPlayerDataEnd';
  const [player] = parsePlayerData(response);

  assert.equal(player.gender, null);
  assert.equal(player.isPrime, false);
  assert.deepEqual(player.mutations, []);
  assert.equal(player.location, null);
});
