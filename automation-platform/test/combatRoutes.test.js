const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

test('combat feed endpoint is separately authenticated, idempotent and disabled by default', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-combat-route-'));
  const oldDbPath = process.env.AUTOMATION_DB_PATH;
  const oldEnabled = process.env.COMBAT_FEED_ENABLED;
  const oldToken = process.env.COMBAT_FEED_TOKEN;
  const oldSource = process.env.COMBAT_FEED_SOURCE;

  process.env.AUTOMATION_DB_PATH = path.join(dir, 'automation.sqlite');
  process.env.COMBAT_FEED_ENABLED = 'true';
  process.env.COMBAT_FEED_TOKEN = 'combat-feed-route-token-1234567890';
  process.env.COMBAT_FEED_SOURCE = 'route-test';

  const servicePath = require.resolve('../src/services/combatEventService');
  const routePath = require.resolve('../src/routes/combatRoutes');
  const authPath = require.resolve('../src/middleware/combatFeedAuth');
  delete require.cache[servicePath];
  delete require.cache[routePath];
  delete require.cache[authPath];

  const router = require(routePath);
  const app = express();
  app.use(express.json());
  app.use('/api/combat', router);

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });

  t.after(() => new Promise((resolve) => server.close(() => {
    delete require.cache[servicePath];
    delete require.cache[routePath];
    delete require.cache[authPath];
    if (oldDbPath === undefined) delete process.env.AUTOMATION_DB_PATH; else process.env.AUTOMATION_DB_PATH = oldDbPath;
    if (oldEnabled === undefined) delete process.env.COMBAT_FEED_ENABLED; else process.env.COMBAT_FEED_ENABLED = oldEnabled;
    if (oldToken === undefined) delete process.env.COMBAT_FEED_TOKEN; else process.env.COMBAT_FEED_TOKEN = oldToken;
    if (oldSource === undefined) delete process.env.COMBAT_FEED_SOURCE; else process.env.COMBAT_FEED_SOURCE = oldSource;
    fs.rmSync(dir, { recursive: true, force: true });
    resolve();
  })));

  const base = 'http://127.0.0.1:' + server.address().port;
  const payload = {
    eventId: 'route-death-0001',
    occurredAt: '2026-09-21T08:00:00.000Z',
    killerSteamId: '76561198000001101',
    killerName: 'Hunter',
    victimSteamId: '76561198000001102',
    victimName: 'Grazer',
  };

  let response = await fetch(base + '/api/combat/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(response.status, 401);

  response = await fetch(base + '/api/combat/events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer wrong-token',
    },
    body: JSON.stringify(payload),
  });
  assert.equal(response.status, 401);

  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer combat-feed-route-token-1234567890',
  };

  response = await fetch(base + '/api/combat/events', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).duplicate, false);

  response = await fetch(base + '/api/combat/events', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).duplicate, true);

  response = await fetch(base + '/api/combat/events', {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...payload, victimSteamId: '76561198000001103' }),
  });
  assert.equal(response.status, 409);

  process.env.COMBAT_FEED_ENABLED = 'false';
  response = await fetch(base + '/api/combat/events', {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...payload, eventId: 'route-death-0002' }),
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'COMBAT_FEED_DISABLED');
});
