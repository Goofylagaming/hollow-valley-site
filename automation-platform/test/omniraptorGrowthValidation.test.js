const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const service = require('../src/services/omniraptorGrowthValidationService');

const id = '76561198038977506';
const OTHER_ID = '76561198000000011';
const NOW = Date.parse('2026-11-01T12:00:00Z');

function snapshot({
  online = true, steamId = id, species = 'Omniraptor', growth = 0.42,
  checkedAt = '2026-11-01T11:59:45.000Z', present = true, status = 'fresh',
} = {}) {
  return {
    configured: true, online, checkedAt, source: 'external-presence',
    cached: true, stale: status === 'stale',
    players: present ? [{ steamId, name: 'test player' }] : [],
    characters: present ? [{
      steamId, species, growth, health: 90, stamina: 80,
      hunger: 70, thirst: 60, mutations: ['test-mutation'],
      location: { x: 11111, y: 22222, z: 33333 },
    }] : [],
  };
}

test('supports 1x through 10x target options, but never applies a multiplier', () => {
  assert.deepEqual(service.GROWTH_TARGETS, [1,2,3,4,5,6,7,8,9,10]);
  const result = service.projectSnapshot(snapshot(), id, { nowMs: NOW });
  assert.equal(result.mode, 'read-only');
  assert.equal(result.gameMutationEnabled, false);
  assert.equal(result.perDinosaurGrowthSupported, false);
  assert.equal(result.status, 'ready');
  assert.equal(result.player.growthPercent, 42);
  assert.equal(result.player.mutationCount, 1);
  assert.equal(result.player.health, 90);
  assert.equal(result.player.thirst, 60);
  assert.equal(result.observedAt, '2026-11-01T11:59:45.000Z');
  assert.equal(result.sampleAgeSeconds, 15);
  assert.equal(result.source, 'external-presence');
  assert.equal(JSON.stringify(result).includes('location'), false);
  assert.equal(JSON.stringify(result).includes('test player'), false);
  assert.equal(result.player.steamId, id);
});

test('exact Omniraptor species and SteamID are required', () => {
  assert.equal(service.canonicalOmniraptor('Omniraptor'), 'omniraptor');
  assert.equal(service.canonicalOmniraptor('BP_Omniraptor_C'), 'omniraptor');
  assert.equal(service.canonicalOmniraptor('Troodon'), null);
  assert.equal(service.canonicalOmniraptor('OmniraptorImposter'), null);
  assert.throws(() => service.projectSnapshot(snapshot(), OTHER_ID.slice(0,10)), /Steam-linked/);

  const off = service.projectSnapshot(snapshot({ present: false }), id, { nowMs: NOW });
  assert.equal(off.status, 'player-offline');
  const wrong = service.projectSnapshot(snapshot({ species: 'Triceratops' }), id, { nowMs: NOW });
  assert.equal(wrong.status, 'not-omniraptor');
  assert.equal(wrong.player.growthPercent, null);

  const other = service.projectSnapshot(snapshot({ steamId: OTHER_ID }), id, { nowMs: NOW });
  assert.equal(other.status, 'player-offline');
  assert.equal(JSON.stringify(other).includes(OTHER_ID), false, 'no unrelated Steam ID may leak');
});

test('stale or unavailable game data fails closed', () => {
  assert.equal(service.projectSnapshot(snapshot({ online: false }), id, { nowMs: NOW }).status, 'server-unavailable');
  assert.equal(service.projectSnapshot(snapshot({ checkedAt: null }), id, { nowMs: NOW }).status, 'unverified-timestamp');
  assert.equal(service.projectSnapshot(snapshot({ checkedAt: '2026-11-01T11:57:00Z' }), id, { nowMs: NOW }).status, 'stale-snapshot');
  assert.equal(service.projectSnapshot(snapshot({ status: 'stale' }), id, { nowMs: NOW }).status, 'stale-snapshot');
  assert.equal(service.projectSnapshot(snapshot({ checkedAt: '2026-11-01T12:01:00Z' }), id, { nowMs: NOW }).status, 'unverified-timestamp');
});

test('fraction, percent and full-grown growth values are bounded', () => {
  assert.equal(service.growthPercent(0), 0);
  assert.equal(service.growthPercent(0.3825), 38.25);
  assert.equal(service.growthPercent(42.25), 42.25);
  assert.equal(service.growthPercent(100), 100);
  for (const invalid of [-1, 100.1, Infinity, NaN, '42', null]) {
    assert.equal(service.growthPercent(invalid), null);
  }
  assert.equal(service.projectSnapshot(snapshot({ growth: 1 }), id, { nowMs: NOW }).status, 'fully-grown');
  assert.equal(service.projectSnapshot(snapshot({ growth: -1 }), id, { nowMs: NOW }).status, 'growth-unavailable');
});

test('service code contains no executable growth/RCON writes', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/omniraptorGrowthValidationService.js'), 'utf8');
  for (const forbidden of [
    'executeRconCommand', 'SetGrowth(', 'SetGrowthMultiplier(', 'Stop-Process',
    'applyWalletTransaction', 'setAdminGrowthMultiplier', 'writeFileSync',
  ]) {
    assert.equal(source.includes(forbidden), false, 'read-only module must not contain ' + forbidden);
  }
});
