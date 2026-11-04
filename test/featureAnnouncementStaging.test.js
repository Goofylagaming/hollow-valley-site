// Isolated website -> automation -> durable outbox staging, without live workers.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
process.env.DB_PATH = ':memory:';
process.env.AUTOMATION_DB_PATH = ':memory:';
process.env.AUTOMATION_ADMIN_TOKEN = randomUUID();
process.env.HERBYBOT_AUTOMATION_TOKEN = 'isolated-no-consumer';
process.env.RCON_GROWTH_MULTIPLIER_WRITE_ENABLED = 'true';
process.env.RCON_WRITE_ENABLED = 'true';
process.env.RCON_GROWTH_EXPERIMENTAL_ENABLED = 'false';
const express = require('express');
const backendRouter = require('../automation-platform/src/routes/adminRoutes');
const siteRouter = require('../server/routes/adminOperations');
const store = require('../automation-platform/src/services/automationStore');

test('staged feature publication is authenticated, durable and does not enable growth', async t => {
  async function listen(app) {
    const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
    t.after(() => new Promise(resolve => server.close(resolve)));
    return `http://127.0.0.1:${server.address().port}`;
  }
  const backend = express(); backend.use(express.json()); backend.use('/api/admin', backendRouter);
  process.env.AUTOMATION_SERVICE_URL = await listen(backend);
  const site = express(); site.use(express.json());
  site.use((req,res,next) => { req.user = { id: 7, is_admin: 1, steam_id: '76561198000000007' }; next(); });
  site.use('/api/admin-operations', siteRouter);
  const url = await listen(site);
  const post = (path, body) => fetch(url + '/api/admin-operations' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post('/growth-multiplier', { value: 3, confirm: 'TEST GROWTH', experimental: true })).status, 503);
  assert.equal(store.listOutboxEvents({}).length, 0);
  const body = { kind: 'growth', multiplier: 3, channels: ['announcement', 'progress'], requestId: randomUUID(), verified: true, confirm: 'ANNOUNCE VERIFIED' };
  const first = await post('/feature-announcement', body);
  assert.equal(first.status, 202);
  const receipt = await first.json();
  assert.equal(receipt.announcement.deliveryConfirmed, false);
  assert.equal(receipt.announcement.receipts.length, 2);
  assert.deepEqual(await (await post('/feature-announcement', body)).json(), receipt);
  assert.equal(store.listOutboxEvents({}).length, 2);
  assert.equal((await post('/feature-announcement', { ...body, multiplier: 5 })).status, 409);
  assert.equal(store.listOutboxEvents({}).length, 2);
  const audit = store.listAudit({ category: 'feature_announcement' });
  assert.equal(audit[0].details.actorSteamId, '76561198000000007');
});
