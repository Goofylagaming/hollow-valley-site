const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.AUTOMATION_DB_PATH = ':memory:';
process.env.AUTOMATION_ADMIN_TOKEN = 'test-automation-admin-secret';
process.env.SPECIES_COIN_EVENTS_ENABLED = 'true';

const router = require('../src/routes/adminRoutes');
function serve() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', router);
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('species event administration requires token, rejects growth and stop confirmation, and lists safely', async (t) => {
  const server = await serve();
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port + '/api/admin/species-coin-events';
  const input = {
    requestId: '3e24e01b-63f3-4bfa-b23f-dfca10fd14b6',
    title: 'Raptor Hour', species: 'omniraptor',
    coinsPerMinute: 40, durationMinutes: 60,
    actorSteamId: '76561198038977506',
  };
  async function post(url, body, authorized = true) {
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authorized ? { Authorization: 'Bearer test-automation-admin-secret' } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  assert.equal((await post(base, input, false)).status, 401);
  assert.equal((await post(base, { ...input, growthMultiplier: 2 })).status, 400);
  assert.equal((await post(base, { ...input, coinsPerMinute: 100000 })).status, 400);
  assert.equal((await post(base, { ...input, pingMode: '@everyone' })).status, 400);
  assert.equal((await post(base, { ...input, pingMode: 'community', autoAnnounce: false })).status, 400);
  const created = await post(base, input);
  assert.equal(created.status, 201);
  const first = await created.json();
  assert.equal(first.event.title, 'Raptor Hour');
  assert.equal(first.event.species, 'omniraptor');
  assert.equal(first.event.coinsPerMinute, 40);
  assert.equal(first.event.pingMode, 'none', 'existing API calls are silent by default');
  const replay = await post(base, input);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).duplicate, true);

  const listing = await fetch(base, {
    headers: { Authorization: 'Bearer test-automation-admin-secret' },
  });
  assert.equal(listing.status, 200);
  const state = await listing.json();
  assert.equal(state.enabled, true);
  assert.equal(state.perSpeciesGrowthSupported, false);
  assert.ok(state.events.some(event => event.id === first.event.id));

  assert.equal((await post(base + '/' + first.event.id + '/stop', {})).status, 400);
  const stopped = await post(base + '/' + first.event.id + '/stop', {
    confirm: 'STOP EVENT', actorSteamId: '76561198038977506',
  });
  assert.equal(stopped.status, 200);
  assert.equal((await stopped.json()).event.status, 'stopped');
});

test('automation admin API creates one idempotent multi-dinosaur event and refuses overlapping species', async t => {
  const server = await serve();
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port + '/api/admin/species-coin-events';
  const post = data => fetch(base, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-automation-admin-secret',
    },
    body: JSON.stringify(data),
  });
  const group = {
    requestId: '6a3e1e52-868c-4598-a1cb-b0ab6a96b12a',
    title: 'Carnivore Bonus Hour',
    speciesBonuses: [
      { species: 'pteranodon', coinsPerMinute: 300 },
      { species: 'triceratops', coinsPerMinute: 500 },
    ],
    durationMinutes: 60,
    actorSteamId: '76561198038977506',
  };
  const created = await post(group);
  assert.equal(created.status, 201);
  const first = await created.json();
  assert.equal(first.event.isMultiSpecies, true);
  assert.equal(first.event.speciesBonuses.length, 2);
  assert.equal(first.event.speciesBonuses[0].species, 'pteranodon');
  assert.equal((await post({ ...group, speciesBonuses: [...group.speciesBonuses].reverse() })).status, 200);
  const collision = await post({ ...group, requestId: '6a3e1e52-868c-4598-a1cb-b0ab6a96b12b',
    speciesBonuses: [{ species: 'triceratops', coinsPerMinute: 200 }],
  });
  assert.equal(collision.status, 409);
  const listing = await fetch(base, {
    headers: { Authorization: 'Bearer test-automation-admin-secret' },
  });
  const data = await listing.json();
  assert.equal(data.multipleSpeciesSupported, true);
  assert.equal(data.maxSpeciesPerEvent, 21);
  const saved = data.events.find(event => event.id === first.event.id);
  assert.equal(saved.speciesCount, 2);
});

