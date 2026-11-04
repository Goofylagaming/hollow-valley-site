const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

process.env.DB_PATH = ':memory:';
const automation = require('../server/services/automationWebsiteClient');
const adminRouter = require('../server/routes/adminOperations');
const OWNER_ID = '76561198038977506';

function appFor(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/admin-operations', adminRouter);
  return app;
}

function serve(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function endpoint(server) {
  return 'http://127.0.0.1:' + server.address().port +
    '/api/admin-operations/growth-validation/omniraptor';
}

test('Omniraptor observation requires logged-in Steam-linked admin', async t => {
  for (const user of [
    null,
    { id: 1, is_admin: 0, steam_id: OWNER_ID },
    { id: 1, is_admin: 1, steam_id: null },
  ]) {
    const server = await serve(appFor(user));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const res = await fetch(endpoint(server));
    assert.equal(res.status, user?.is_admin ? 409 : user ? 403 : 401);
  }
});

test('the website always observes its authenticated Steam-linked user, ignoring browser-supplied IDs', async t => {
  const original = automation.getAdminOmniraptorGrowthValidation;
  const requestedIds = [];
  automation.getAdminOmniraptorGrowthValidation = async id => {
    requestedIds.push(id);
    return { mode: 'read-only', gameMutationEnabled: false,
      perDinosaurGrowthSupported: false, status: 'ready',
      player: { steamId: id, species: 'Omniraptor', growthPercent: 40 },
    };
  };
  t.after(() => { automation.getAdminOmniraptorGrowthValidation = original; });

  const server = await serve(appFor({ id: 1, is_admin: 1, steam_id: OWNER_ID }));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(endpoint(server) + '?steamId=76561198000000000&value=10');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  const json = await response.json();
  assert.equal(json.player.steamId, OWNER_ID);
  assert.deepEqual(requestedIds, [OWNER_ID]);
  const post = await fetch(endpoint(server), { method: 'POST' });
  assert.equal(post.status, 404, 'no growth writer endpoint exists');
});

test('admin UI displays all ten growth targets and is explicitly read-only', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/adminoperations.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../public/assets/omniraptor-growth-validation.js'), 'utf8');
  const section = html.split('id="omni-growth-validation"')[1]?.split('</section>')[0] || '';
  assert.match(section, /OMNIRAPTOR GROWTH VALIDATION/);
  assert.match(section, /No option applies growth yet/);
  const targets = [...section.matchAll(/<option value="(\d+)"[^>]*>\d+× growth<\/option>/g)].map(x => Number(x[1]));
  assert.deepEqual(targets, [1,2,3,4,5,6,7,8,9,10]);
  assert.match(section, /Start read-only observation/);
  assert.match(section, /Copy test report/);
  assert.match(js, /POLL_MS = 30_000/);
  assert.match(js, /MAX_DURATION_MS = 10 \* 60_000/);
  assert.match(js, /MAX_GAP_MS = 90_000/);
  assert.match(js, /growth-validation\/omniraptor/);
  assert.match(js, /mode !== 'read-only'/);
  assert.doesNotMatch(js, /method:\s*'POST'/);
  for (const forbidden of ['SetGrowth(', 'setgrowthmultiplier', '0x22', 'Stop-Process', 'Game.ini=']) {
    assert.ok(!js.includes(forbidden), 'dry-run must not mutate game with ' + forbidden);
  }
});
