const test = require('node:test');
const assert = require('node:assert/strict');

function loadWithClientStubs(stubs = {}) {
  const clientPath = require.resolve('../integration/websiteAutomationClient');
  const adapterPath = require.resolve('../integration/liveRouteAdapters');
  const originalClient = require(clientPath);
  require.cache[clientPath].exports = { ...originalClient, ...stubs };
  delete require.cache[adapterPath];
  const adapters = require(adapterPath);
  return {
    adapters,
    restore() {
      require.cache[clientPath].exports = originalClient;
      delete require.cache[adapterPath];
    },
  };
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('route adapter derives Steam identity from authenticated req.user', async (t) => {
  let seenSteamId = null;
  const fixture = loadWithClientStubs({
    listStoredDinos: async (steamId) => {
      seenSteamId = steamId;
      return { dinos: [{ slot: 'default', species: 'Triceratops' }] };
    },
  });
  t.after(fixture.restore);

  const req = { user: { steam_id: '76561198000000000' }, query: { steamId: '76561198999999999' } };
  const res = response();
  await fixture.adapters.listDinos(req, res);

  assert.equal(seenSteamId, '76561198000000000');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body[0].species, 'Triceratops');
});

test('accepted DinoStorage action remains explicitly unconfirmed', async (t) => {
  const fixture = loadWithClientStubs({
    requestDinoAction: async () => ({
      request: { id: 'request_12345678', status: 'queued', message: 'Awaiting DinoStorage result.' },
    }),
  });
  t.after(fixture.restore);

  const req = { user: { steam_id: '76561198000000000' } };
  const res = response();
  await fixture.adapters.runDinoAction(req, res, 'store', 'dino-slot');

  assert.equal(res.statusCode, 202);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.result.confirmed, false);
  assert.equal(res.body.result.completionConfirmed, false);
  assert.equal(res.body.result.requestId, 'request_12345678');
});

test('automation timeout is surfaced without replaying the original action', async (t) => {
  let calls = 0;
  const fixture = loadWithClientStubs({
    requestBodyDrop: async () => {
      calls += 1;
      const error = new Error('Automation service request timed out');
      error.code = 'AUTOMATION_TIMEOUT';
      throw error;
    },
  });
  t.after(fixture.restore);

  const req = { user: { steam_id: '76561198000000000' }, body: { dropType: 'small' } };
  const res = response();
  await fixture.adapters.requestBodyDrop(req, res);

  assert.equal(calls, 1);
  assert.equal(res.statusCode, 504);
  assert.match(res.body.error, /not automatically retried/i);
});

test('missing login is rejected before contacting automation service', async (t) => {
  let calls = 0;
  const fixture = loadWithClientStubs({
    listStoredDinos: async () => { calls += 1; return { dinos: [] }; },
  });
  t.after(fixture.restore);

  const res = response();
  await fixture.adapters.listDinos({}, res);

  assert.equal(calls, 0);
  assert.equal(res.statusCode, 401);
});


test('BodyDrop state preserves automation eligibility and restrictions for the live frontend', async (t) => {
  const fixture = loadWithClientStubs({
    getBodyDropCooldown: async () => ({
      serverOnline: true,
      cooldown: { active: false, remainingSeconds: 0, latest: null },
      eligibility: { eligible: false, reason: 'Body drops are only available to carnivores.', species: 'Triceratops' },
      restrictions: { carnivoreOnly: true, maxGrowthPercent: 60 },
    }),
  });
  t.after(fixture.restore);

  const req = { user: { steam_id: '76561198000000000' } };
  const res = response();
  await fixture.adapters.getBodyDropState(req, res, { options: [{ id: 'small' }] });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.serverOnline, true);
  assert.equal(res.body.eligibility.eligible, false);
  assert.match(res.body.eligibility.reason, /carnivores/i);
  assert.deepEqual(res.body.restrictions, { carnivoreOnly: true, maxGrowthPercent: 60 });
});

test('BodyDrop 403 keeps eligibility details instead of becoming a generic proxy error', async (t) => {
  const fixture = loadWithClientStubs({
    requestBodyDrop: async () => {
      const error = new Error('Body drops are only available at 60% growth or below.');
      error.status = 403;
      error.payload = {
        error: error.message,
        eligibility: { eligible: false, growthPercent: 72, maxGrowthPercent: 60 },
      };
      throw error;
    },
  });
  t.after(fixture.restore);

  const req = { user: { steam_id: '76561198000000000' }, body: { dropType: 'small' } };
  const res = response();
  await fixture.adapters.requestBodyDrop(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.eligibility.eligible, false);
  assert.equal(res.body.eligibility.growthPercent, 72);
});


test('active-character adapter preserves the live My Dinos response shape', async (t) => {
  const fixture = loadWithClientStubs({
    getActiveCharacter: async () => ({
      active: true,
      character: {
        name: 'Young Carno',
        species: 'Carnotaurus',
        gender: 'Female',
        growth: 0.42,
        health: 80,
        stamina: 70,
        hunger: 60,
        thirst: 50,
        isPrime: false,
        mutations: ['Truculency'],
        location: { x: 1, y: 2, z: 3 },
      },
    }),
  });
  t.after(fixture.restore);

  const req = { user: { steam_id: '76561198000000000' } };
  const res = response();
  await fixture.adapters.getActiveCharacter(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.active, true);
  assert.equal(res.body.character.species, 'Carnotaurus');
  assert.equal(res.body.character.gender, 'Female');
  assert.equal(res.body.character.growth, 0.42);
  assert.deepEqual(res.body.character.mutations, ['Truculency']);
});
