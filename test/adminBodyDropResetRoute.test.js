const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.DB_PATH = ':memory:';

const resetClient = require('../server/services/adminBodyDropResetClient');
const router = require('../server/routes/adminBodyDropReset');

function appFor(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user || null; next(); });
  app.use('/api/admin-bodydrop-reset', router);
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function baseUrl(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

test('BodyDrop reset website route requires admin access', async (t) => {
  for (const user of [null, { id: 1, is_admin: 0 }]) {
    const server = await listen(appFor(user));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const response = await fetch(`${baseUrl(server)}/api/admin-bodydrop-reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ steamId: '76561198000000888', confirm: 'RESET BODYDROP' }),
    });
    assert.equal(response.status, user ? 403 : 401);
  }
});

test('BodyDrop reset requires exact confirmation before calling automation', async (t) => {
  const original = resetClient.resetBodyDropCooldown;
  let calls = 0;
  resetClient.resetBodyDropCooldown = async () => {
    calls += 1;
    return { ok: true, reset: { changed: true } };
  };
  t.after(() => { resetClient.resetBodyDropCooldown = original; });

  const server = await listen(appFor({ id: 1, is_admin: 1 }));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  let response = await fetch(`${baseUrl(server)}/api/admin-bodydrop-reset`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ steamId: '76561198000000888', confirm: 'reset' }),
  });
  assert.equal(response.status, 400);
  assert.equal(calls, 0);

  response = await fetch(`${baseUrl(server)}/api/admin-bodydrop-reset`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ steamId: '76561198000000888', confirm: 'RESET BODYDROP' }),
  });
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
});
