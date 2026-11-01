const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.AUTOMATION_DB_PATH = ':memory:';
process.env.AUTOMATION_ADMIN_TOKEN = 'growth-read-only-internal-test-token';

const steamId = '76561198038977506';
const status = require('../src/services/statusService');
const originalSnapshot = status.getServerSnapshot;
let calls = [];
status.getServerSnapshot = async ({ force }) => {
  calls.push({ force });
  return {
    online: true, configured: true, source: 'external-presence',
    checkedAt: new Date().toISOString(),
    players: [
      { steamId, name: 'test user' },
      { steamId: '76561198000000018', name: 'private user' },
    ],
    characters: [
      { steamId, species: 'Omniraptor', growth: 0.42, health: 92 },
      { steamId: '76561198000000018', species: 'Triceratops', growth: 0.55 },
    ],
  };
};
const router = require('../src/routes/adminRoutes');

async function serve() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', router);
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('read-only growth observation is token-protected and never forces game polling', async t => {
  const server = await serve();
  t.after(() => new Promise(resolve => server.close(resolve)));
  t.after(() => { status.getServerSnapshot = originalSnapshot; });
  const url = 'http://127.0.0.1:' + server.address().port +
    '/api/admin/growth-validation/omniraptor?steamId=' + steamId;
  const rejected = await fetch(url);
  assert.equal(rejected.status, 401);
  const invalid = await fetch(url.replace(steamId, 'wrong'), {
    headers: { Authorization: 'Bearer growth-read-only-internal-test-token' },
  });
  assert.equal(invalid.status, 400);

  calls = [];
  const response = await fetch(url, {
    headers: { Authorization: 'Bearer growth-read-only-internal-test-token' },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  const body = await response.json();
  assert.equal(body.mode, 'read-only');
  assert.equal(body.gameMutationEnabled, false);
  assert.equal(body.perDinosaurGrowthSupported, false);
  assert.deepEqual(body.allowedTargetMultipliers, [1,2,3,4,5,6,7,8,9,10]);
  assert.equal(body.status, 'ready');
  assert.equal(body.player.growthPercent, 42);
  assert.deepEqual(calls, [{ force: false }], 'must reuse cached presence instead of RCON force-refresh');
  const safeJson = JSON.stringify(body);
  assert.equal(safeJson.includes('private user'), false);
  assert.equal(safeJson.includes('76561198000000018'), false);
  const post = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer growth-read-only-internal-test-token' },
  });
  assert.equal(post.status, 404, 'no gameplay mutation endpoint is provided');
});
