const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

process.env.DB_PATH = ':memory:';
const automation = require('../server/services/automationWebsiteClient');
const admin = require('../server/routes/adminOperations');
const events = require('../server/routes/events');

function serve(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/admin-operations', admin);
  app.use('/api/events', events);
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}
const base = (server) => 'http://127.0.0.1:' + server.address().port;

test('only Steam-linked admins can create bonus events and identity cannot be spoofed', async (t) => {
  const original = automation.createAdminSpeciesCoinEvent;
  const calls = [];
  automation.createAdminSpeciesCoinEvent = async (payload) => {
    calls.push(payload);
    return { ok: true, event: { id: 'one', species: payload.species } };
  };
  t.after(() => { automation.createAdminSpeciesCoinEvent = original; });

  const adminUser = { id: 1, is_admin: 1, steam_id: '76561198038977506' };
  const server = await serve(adminUser);
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function post(data) {
    return fetch(base(server) + '/api/admin-operations/species-coin-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
      body: JSON.stringify(data),
    });
  }
  const input = {
    title: 'Omniraptor Spotlight', species: 'omniraptor',
    coinsPerMinute: 75, durationMinutes: 30,
    requestId: '516e0f32-d0d5-4b53-bdab-32fdf208ff3d',
    actorSteamId: '76561198000000000',
  };
  assert.equal((await post({ ...input, species: 'fictionaldinosaur' })).status, 400);
  assert.equal((await post({ ...input, growthMultiplier: 4 })).status, 400);
  assert.equal((await post({ ...input, durationMinutes: 0 })).status, 400);
  assert.equal((await post(input)).status, 201);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].actorSteamId, adminUser.steam_id);
});

test('public event listing hides administrator identity and private settings', async (t) => {
  const original = automation.getAdminSpeciesCoinEvents;
  automation.getAdminSpeciesCoinEvents = async () => ({
    enabled: true,
    events: [
      { id: 'active', title: 'Raptor Week', species: 'omniraptor', coinsPerMinute: 40,
        startsAt: '2026-11-01T00:00:00.000Z', endsAt: '2026-11-01T10:00:00.000Z',
        status: 'active', createdBy: '76561198038977506', requestId: 'secret' },
      { id: 'expired', title: 'Old', species: 'deinosuchus', status: 'expired' },
    ],
  });
  t.after(() => { automation.getAdminSpeciesCoinEvents = original; });
  const server = await serve(null);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const res = await fetch(base(server) + '/api/events/species-bonuses');
  assert.equal(res.status, 200);
  const state = await res.json();
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].species, 'omniraptor');
  assert.equal(Object.hasOwn(state.events[0], 'createdBy'), false);
  assert.equal(Object.hasOwn(state.events[0], 'requestId'), false);
});

test('random event form visibly distinguishes supported minute coins and unavailable growth', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/adminoperations.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../public/assets/species-events-admin.js'), 'utf8');
  const publicEvents = fs.readFileSync(path.join(__dirname, '../public/events.html'), 'utf8');
  assert.match(html, /id="ops-species-event-form"/);
  assert.match(html, /Species-only growth/);
  assert.match(html, /Not supported yet/);
  assert.match(js, /\/api\/admin-operations\/species-coin-events/);
  assert.match(js, /crypto\.randomUUID/);
  assert.match(publicEvents, /RANDOM DINOSAUR BONUSES/);
});

test('random event UI consistently displays Brisbane time, not browser or Render local time', () => {
  const admin = fs.readFileSync(path.join(__dirname, '../public/assets/species-events-admin.js'), 'utf8');
  const player = fs.readFileSync(path.join(__dirname, '../public/assets/events-species-bonuses.js'), 'utf8');
  for (const script of [admin, player]) {
    assert.match(script, /Australia\/Brisbane/);
    assert.match(script, /QLD time/);
    assert.doesNotMatch(script, /date\.toLocaleString\('en-AU'\)/);
  }
});
