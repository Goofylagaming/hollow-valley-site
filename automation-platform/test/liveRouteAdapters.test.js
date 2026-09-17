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
