const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

process.env.DB_PATH = ':memory:';
const automation = require('../server/services/automationWebsiteClient');
const router = require('../server/routes/adminOperations');

function appFor(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/admin-operations', router);
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function endpoint(server) {
  return `http://127.0.0.1:${server.address().port}/api/admin-operations/growth-multiplier`;
}

test('website growth control is restricted to logged-in admins', async (t) => {
  for (const user of [null, { id: 1, is_admin: 0 }]) {
    const server = await listen(appFor(user));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const result = await fetch(endpoint(server), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 3, confirm: 'TEST GROWTH', experimental: true }),
    });
    assert.equal(result.status, user ? 403 : 401);
  }
});

test('growth controls validate multiplier and confirmation before forwarding', async (t) => {
  const original = automation.setAdminGrowthMultiplier;
  const calls = [];
  automation.setAdminGrowthMultiplier = async (...args) => {
    calls.push(args);
    return { ok: true, result: { action: 'growthMultiplier', sent: true, confirmed: false } };
  };
  t.after(() => { automation.setAdminGrowthMultiplier = original; });

  const server = await listen(appFor({ id: 1, is_admin: 1 }));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  async function post(value, confirm) {
    return fetch(endpoint(server), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value, confirm, experimental: true }),
    });
  }

  assert.equal((await post(12, 'TEST GROWTH')).status, 400);
  assert.equal((await post(3, 'yes')).status, 400);
  assert.deepEqual(calls, []);
  const response = await post(3, 'TEST GROWTH');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).result.confirmed, false);
  assert.deepEqual(calls, [[3, 'TEST GROWTH']]);
});

test('Admin Operations UI labels growth as live-only and confirms before submit', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/adminoperations.html'), 'utf8');
  const client = fs.readFileSync(path.join(__dirname, '../public/assets/adminoperations.js'), 'utf8');
  assert.match(html, /id="ops-growth-value"/);
  assert.match(html, /id="ops-growth-apply"[^>]+disabled/);
  assert.match(html, /does not update the Windows Game.ini/);
  assert.match(client, /rcon\.actionGates\?\.growthMultiplier/);
  assert.match(client, /TEST GROWTH/);
  assert.match(client, /\/api\/admin-operations\/growth-multiplier/);
});
