const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.AUTOMATION_DB_PATH = ':memory:';
process.env.AUTOMATION_ADMIN_TOKEN = 'bodydrop-reset-test-token';

const store = require('../src/services/automationStore');
const router = require('../src/routes/adminBodyDropResetRoutes');

function listen() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/bodydrop-reset', router);
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function url(server) {
  return `http://127.0.0.1:${server.address().port}/api/admin/bodydrop-reset`;
}

test('BodyDrop cooldown reset requires automation admin token', async (t) => {
  const server = await listen();
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(url(server), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ steamId: '76561198000000991' }),
  });
  assert.equal(response.status, 401);
});

test('admin reset cancels only the latest BodyDrop lock and records previous status', async (t) => {
  const steamId = '76561198000000992';
  // Requests created in the same SQLite second are ordered by ID DESC, so use
  // deterministic ascending IDs to make 0002 the latest tie-breaker.
  const oldId = 'bodydrop-reset-0001';
  const latestId = 'bodydrop-reset-0002';

  store.createRequest({
    id: oldId,
    kind: 'bodydrop',
    steamId,
    status: 'confirmed',
    details: { dropType: 'small' },
  });
  store.createRequest({
    id: latestId,
    kind: 'bodydrop',
    steamId,
    status: 'queued',
    details: { dropType: 'medium' },
  });

  const server = await listen();
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(url(server), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.AUTOMATION_ADMIN_TOKEN}`,
    },
    body: JSON.stringify({ steamId }),
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.reset.changed, true);
  assert.equal(body.reset.requestId, latestId);
  assert.equal(body.reset.previousStatus, 'queued');
  assert.equal(store.getRequest(latestId).status, 'cancelled');
  assert.equal(store.getRequest(latestId).details.adminCooldownReset.previousStatus, 'queued');
  assert.equal(store.getRequest(oldId).status, 'confirmed');
});
