'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const serverStatus = require('../server/services/serverStatus');
const automation = require('../server/services/automationWebsiteClient');
const router = require('../server/routes/map');
const A = '76561198000000001';
const B = '76561198000000002';
const C = '76561198000000003';
const D = '76561198000000004';
const sampleId = 'presence-map-test-0001';

function liveState() {
  return {
    configured: true, online: true, stale: false,
    snapshotSource: 'external-presence', sampleId,
    lastChecked: new Date().toISOString(), playerCount: 4, maxPlayers: 100,
    characters: [A, B, C, D].map((steamId, i) => ({
      steamId, name: ['Goofy', 'Stressed_', 'Shu', 'Chromie'][i],
      species: 'Triceratops', location: { x: i * 1000, y: i * 2000, z: 1000 },
    })),
  };
}
async function withSite(t, state, getGroupmates) {
  const oldState = serverStatus.getState;
  const oldGet = automation.getVerifiedNativeGroupmates;
  const oldToggle = process.env.GROUPMATES_API_ENABLED;
  process.env.GROUPMATES_API_ENABLED = '1';
  serverStatus.getState = () => state;
  automation.getVerifiedNativeGroupmates = getGroupmates;
  const app = express();
  app.use((req, _res, next) => {
    if (req.headers['x-test-steam']) req.user = {
      steam_id: req.headers['x-test-steam'], is_admin: req.headers['x-test-admin'] === '1',
    };
    next();
  });
  app.use('/api/map', router);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    serverStatus.getState = oldState;
    automation.getVerifiedNativeGroupmates = oldGet;
    if (oldToggle === undefined) delete process.env.GROUPMATES_API_ENABLED;
    else process.env.GROUPMATES_API_ENABLED = oldToggle;
  });
  return 'http://127.0.0.1:' + server.address().port + '/api/map/positions';
}

test('map requires login; only same-group peers get private positions', async (t) => {
  const url = await withSite(t, liveState(), async (id) => {
    assert.equal(id, A);
    return {
      verified: true, presenceSampleId: sampleId,
      sampledAt: new Date().toISOString(), memberSteamIds: [A, B, B, C],
    };
  });
  assert.equal((await fetch(url)).status, 401);
  const body = await (await fetch(url, { headers: { 'x-test-steam': A } })).json();
  assert.equal(body.groupmatesVerified, true);
  assert.deepEqual(body.groupmates.map(({ name }) => name).sort(), ['Shu', 'Stressed_']);
  assert.equal(body.groupmates.every((m) => m.position && !('steamId' in m)), true);
  assert.equal(body.others.length, 3);
  assert.equal(body.others.every((entry) => !('position' in entry) && !('coords' in entry)), true);
  assert.equal(body.me.name, 'Goofy');
});

test('wrong tick, service failure and old coordinates reveal no peers', async (t) => {
  const state = liveState();
  let result = { verified: true, presenceSampleId: 'presence-wrong-tick',
    sampledAt: new Date().toISOString(), memberSteamIds: [B] };
  const url = await withSite(t, state, async () => { if (result instanceof Error) throw result; return result; });
  const headers = { 'x-test-steam': A };
  const mismatch = await (await fetch(url, { headers })).json();
  assert.equal(mismatch.groupmatesVerified, false);
  assert.deepEqual(mismatch.groupmates, []);
  result = new Error('automation unreachable');
  const failed = await (await fetch(url, { headers })).json();
  assert.equal(failed.groupmatesVerified, false);
  assert.deepEqual(failed.groupmates, []);
  state.lastChecked = new Date(Date.now() - 46_000).toISOString();
  result = { verified: true, presenceSampleId: sampleId,
    sampledAt: new Date().toISOString(), memberSteamIds: [B] };
  const stale = await (await fetch(url, { headers })).json();
  assert.equal(stale.groupmatesVerified, false);
  assert.deepEqual(stale.groupmates, []);
});

test('admin moderation positions and ordinary player privacy remain unchanged', async (t) => {
  const url = await withSite(t, liveState(), async () => ({ verified: false, memberSteamIds: [] }));
  const admin = await (await fetch(url, { headers: { 'x-test-steam': A, 'x-test-admin': '1' } })).json();
  assert.equal(admin.othersHavePositions, true);
  assert.equal(admin.others.every((entry) => Boolean(entry.position)), true);
  assert.equal(admin.groupmatesVerified, false);
  const player = await (await fetch(url, { headers: { 'x-test-steam': A } })).json();
  assert.equal(player.othersHavePositions, false);
  assert.equal(player.others.every((entry) => !('position' in entry)), true);
});
