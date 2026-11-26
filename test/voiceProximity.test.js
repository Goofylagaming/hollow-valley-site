'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  readSnapshot,
  proximity,
  authorizedPair,
  assessVoice,
  explainVoice,
} = require('../server/services/voiceProximity');

const now = Date.parse('2026-11-19T04:37:02Z');
const player = (id, x, y = 0, z = 0) => ({ PlayerID: id, Location: { X: x, Y: y, Z: z } });
const make = (players, overrides = {}) => ({
  GeneratedAt: new Date(now).toISOString(),
  ServerOnline: true,
  RconOnline: true,
  PlayerCount: players.length,
  Players: players,
  ...overrides,
});

test('fresh scanner snapshot accepts numeric XYZ and IDs', () => {
  const state = readSnapshot(make([player('76561198000000001', 0)]), { nowMs: now });
  assert.equal(state.valid, true);
  assert.equal(state.players.size, 1);
});

test('RCON offline and stale snapshot fail closed', () => {
  assert.equal(readSnapshot(make([player('12', 0)], { RconOnline: false }), { nowMs: now }).valid, false);
  assert.equal(readSnapshot(make([player('12', 0)]), { nowMs: now + 60000 }).valid, false);
  assert.equal(readSnapshot(make([player('12', 0)], { GeneratedAt: 'nonsense' }), { nowMs: now }).valid, false);
});

test('position validation rejects invalid XYZ, duplicate IDs and missing IDs', () => {
  const state = readSnapshot(make([
    player('1', 0),
    player('1', 12),
    { PlayerID: '2', Location: { X: '2', Y: 0, Z: 0 } },
    player(null, 3),
    player('3', 9),
  ]), { nowMs: now });
  assert.deepEqual([...state.players.keys()], ['3']);
});

test('proximity policy: full under 20m, fade and silence by 100m', () => {
  const origin = { x: 0, y: 0, z: 0 };
  const at20 = { x: 2000, y: 0, z: 0 };
  const at60 = { x: 6000, y: 0, z: 0 };
  const at100 = { x: 10000, y: 0, z: 0 };
  assert.equal(proximity(origin, at20, 100).gain, 1);
  assert.equal(proximity(origin, at60, 100).gain, 0.5);
  assert.equal(proximity(origin, at100, 100).audible, false);
  assert.equal(proximity(origin, { x: 0, y: 3000, z: 4000 }, 100).gain, 0.625);
  assert.throws(() => proximity(origin, at20, 0), /unitsPerMeter/);
});

test('missing player and self never authorize', () => {
  const state = readSnapshot(make([player('1', 0), player('2', 5000)]), { nowMs: now });
  assert.equal(authorizedPair(state, '1', '2', 100).audible, true);
  assert.equal(authorizedPair(state, '1', '3', 100).audible, false);
  assert.equal(authorizedPair(state, '1', '1', 100).audible, false);
});

function character(steamId, x, y = 0, z = 0, name = 'Survivor') {
  return { steamId, name, species: 'Tyrannosaurus', health: 88, location: { x, y, z } };
}

function websiteCache(characters, overrides = {}) {
  const lastChecked = new Date(now).toISOString();
  return {
    online: true,
    stale: false,
    lastError: null,
    lastChecked,
    voiceSampledAt: lastChecked,
    characters,
    players: characters.map((entry) => ({ steamId: entry.steamId, name: entry.name })),
    ...overrides,
  };
}

test('website cache uses raw 3D distance and keeps coordinates out of gains', () => {
  const self = '76561198000000011';
  const near = '76561198000000012';
  const mid = '76561198000000013';
  const far = '76561198000000014';
  const result = assessVoice(websiteCache([
    character(self, 0, 0, 0, 'Moss'),
    character(near, 2000, 0, 0, 'Fern'),
    character(mid, 0, 3000, 4000, 'Brook'),
    character(far, 10000, 0, 0, 'Stone'),
  ]), self, { nowMs: now, unitsPerMeter: 100 });
  assert.equal(result.ok, true);
  assert.equal(result.displayName, 'Moss');
  assert.deepEqual(result.gains, [
    { identity: near, gain: 1, audible: true, displayName: 'Fern' },
    { identity: mid, gain: 0.625, audible: true, displayName: 'Brook' },
    { identity: far, gain: 0, audible: false, displayName: 'Stone' },
  ]);
  const encoded = JSON.stringify(result.gains);
  for (const secret of ['2000', '3000', '4000', '10000', 'location', 'species', 'Tyrannosaurus', 'distance']) {
    assert.equal(encoded.includes(secret), false, secret);
  }
  for (const entry of result.gains) {
    assert.deepEqual(Object.keys(entry), ['identity', 'gain', 'audible', 'displayName']);
  }
});

test('website cache fails closed when stale, offline, or RCON is not online', () => {
  const self = '76561198000000011';
  const characters = [character(self, 812345.125, -743210.5, 99001.25, 'Moss')];
  const fresh = websiteCache(characters);
  assert.equal(assessVoice(fresh, self, { nowMs: now + 30001, unitsPerMeter: 100 }).ok, false);
  assert.equal(assessVoice(websiteCache(characters, { online: false }), self, { nowMs: now, unitsPerMeter: 100 }).reason, 'unavailable');
  assert.equal(assessVoice(websiteCache(characters, { rconOnline: false }), self, { nowMs: now, unitsPerMeter: 100 }).reason, 'unavailable');
  assert.equal(assessVoice(websiteCache(characters, { serverOnline: false }), self, { nowMs: now, unitsPerMeter: 100 }).ok, false);
  assert.equal(assessVoice(websiteCache(characters, { stale: true }), self, { nowMs: now, unitsPerMeter: 100 }).ok, false);
  assert.equal(assessVoice(websiteCache(characters, { voiceSampledAt: null }), self, { nowMs: now, unitsPerMeter: 100 }).reason, 'stale_timestamp');
  const leaked = JSON.stringify(assessVoice(websiteCache(characters, { rconOnline: false }), self, { nowMs: now, unitsPerMeter: 100 }));
  assert.equal(leaked.includes('812345'), false);
  assert.equal(leaked.includes('743210'), false);
});

test('a fresh positioned player passes and the explanation has no coordinates', () => {
  const self = '76561198000000011';
  const state = websiteCache([
    character(self, 812345.125, -743210.5, 99001.25, 'Moss'),
  ]);
  const explained = explainVoice(state, self, { nowMs: now, unitsPerMeter: 100 });
  assert.equal(explained.ok, true);
  assert.equal(explained.reason, 'ok');
  assert.equal(explained.ageMs, 0);
  assert.equal(explained.selfPositioned, true);
  assert.equal(explained.positionedCount, 1);
  assert.equal(explained.serverFlag, 'absent');
  assert.equal(explained.rconFlag, 'absent');
  const encoded = JSON.stringify(explained);
  for (const secret of ['812345', '743210', '99001', 'location', 'Moss', self]) {
    assert.equal(encoded.includes(secret), false, secret);
  }
});

test('missing coordinates are not on server even when the public status is online', () => {
  const self = '76561198000000011';
  const state = websiteCache([{ steamId: self, name: 'Goofy', species: 'Tyrannosaurus', location: null }]);
  const explained = explainVoice(state, self, { nowMs: now, unitsPerMeter: 100 });
  assert.equal(explained.reason, 'not_on_server');
  assert.equal(explained.online, true);
  assert.equal(explained.positionedCount, 0);
  assert.equal(explained.selfPositioned, false);
  assert.equal(JSON.stringify(explained).includes('Goofy'), false);
});

test('duplicate website identities and a missing player are not authorized', () => {
  const self = '76561198000000021';
  const other = '76561198000000022';
  const duplicated = assessVoice(websiteCache([
    character(self, 0, 0, 0, 'Moss'),
    character(self, 50, 0, 0, 'Moss'),
    character(other, 100, 0, 0, 'Fern'),
  ]), self, { nowMs: now, unitsPerMeter: 100 });
  assert.equal(duplicated.reason, 'not_on_server');
  assert.deepEqual(duplicated.gains, []);
  const absent = assessVoice(websiteCache([
    character(other, 0, 0, 0, 'Fern'),
  ]), self, { nowMs: now, unitsPerMeter: 100 });
  assert.equal(absent.reason, 'not_on_server');
});
