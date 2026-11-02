'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.AUTOMATION_DB_PATH = ':memory:';
process.env.GROUPMATES_NATIVE_SOURCE_VERIFIED = '1';
process.env.GROUPMATES_FEED_TOKEN = 'staging-group-feed-token-test-0123456789012345';
process.env.HOLLOW_VALLEY_API_TOKEN = 'staging-website-token';
process.env.PLAYER_PRESENCE_ENABLED = 'false';
const { app } = require('../src/index');
const statusService = require('../src/services/statusService');
const nativeGroups = require('../src/services/nativeGroupMembershipService');
const A = '76561198000000001';
const B = '76561198000000002';
let stamp;
let presenceId;

function listen() {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}
function post(base, body, token) {
  return fetch(base + '/api/group-feed/snapshot', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: JSON.stringify(body),
  });
}
test('native-group receiver is private, complete and filtered for website server', async (t) => {
  const originalStatus = statusService.getServerSnapshot;
  nativeGroups.resetForTests();
  stamp = new Date().toISOString();
  presenceId = 'binarylane-presence-staging-1';
  statusService.getServerSnapshot = async () => ({
    configured: true, online: true, source: 'external-presence', stale: false,
    sampleId: presenceId, checkedAt: stamp, characters: [
      { steamId: A, name: 'Goofy' }, { steamId: B, name: 'Stressed_' },
    ], players: [{ steamId: A }, { steamId: B }],
  });
  t.after(() => { statusService.getServerSnapshot = originalStatus; nativeGroups.resetForTests(); });
  const server = await listen();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const data = {
    schemaVersion: 1, source: 'evrima-native-server-v1',
    complete: true, sampleId: 'native-group-staging-1',
    presenceSampleId: presenceId, sampledAt: stamp,
    groups: [{ id: 'native-group-01', members: [A, B] }],
  };
  assert.equal((await post(base, data)).status, 401);
  assert.equal((await post(base, { ...data, complete: false }, process.env.GROUPMATES_FEED_TOKEN)).status, 400);
  assert.equal((await post(base, data, process.env.GROUPMATES_FEED_TOKEN)).status, 201);
  assert.equal((await post(base, data, process.env.GROUPMATES_FEED_TOKEN)).status, 200);
  const untrusted = await fetch(base + '/api/website/groupmates/' + A);
  assert.equal(untrusted.status, 401);
  const trusted = await fetch(base + '/api/website/groupmates/' + A, {
    headers: { Authorization: 'Bearer ' + process.env.HOLLOW_VALLEY_API_TOKEN },
  });
  assert.equal(trusted.status, 200);
  const body = await trusted.json();
  assert.equal(body.verified, true);
  assert.deepEqual(body.memberSteamIds, [B]);
  assert.equal(JSON.stringify(body).includes('native-group-01'), false);
  assert.match(trusted.headers.get('cache-control') || '', /no-store/);
});
