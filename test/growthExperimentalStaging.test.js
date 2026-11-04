// Full website -> authenticated automation -> local fake RCON; never uses the game host.
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const express = require('express');
process.env.DB_PATH = ':memory:';
process.env.AUTOMATION_DB_PATH = ':memory:';
process.env.AUTOMATION_ADMIN_TOKEN = 'isolated-growth-staging';
process.env.RCON_HOST = '127.0.0.1';
process.env.RCON_PASSWORD = 'isolated-test-password';
process.env.RCON_DISABLED = 'false';
process.env.RCON_GROWTH_MULTIPLIER_WRITE_ENABLED = 'true';
process.env.RCON_GROWTH_EXPERIMENTAL_ENABLED = 'true';
const automationRouter = require('../automation-platform/src/routes/adminRoutes');
const websiteRouter = require('../server/routes/adminOperations');
const store = require('../automation-platform/src/services/automationStore');

test('experimental growth uses bounded scalar packets, cannot claim effect, and fails closed', async t => {
  const packets = [];
  const sockets = new Set();
  const rcon = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    let pending = Buffer.alloc(0);
    socket.on('data', chunk => {
      pending = Buffer.concat([pending, chunk]);
      let end;
      while ((end = pending.indexOf(0)) !== -1) {
        const packet = pending.subarray(0, end + 1); pending = pending.subarray(end + 1);
        if (packet[0] === 1) {
          assert.equal(packet.subarray(1, -1).toString(), process.env.RCON_PASSWORD);
          socket.write('Password Accepted');
        } else {
          packets.push(packet.toString('hex'));
          socket.write('Command received'); // Deliberate positive response must NOT become effect confirmation.
        }
      }
    });
  });
  await new Promise(resolve => rcon.listen(0, '127.0.0.1', resolve));
  process.env.RCON_PORT = String(rcon.address().port);
  t.after(() => { for (const socket of sockets) socket.destroy(); return new Promise(resolve => rcon.close(resolve)); });
  async function listen(app) {
    const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
    t.after(() => new Promise(resolve => server.close(resolve)));
    return `http://127.0.0.1:${server.address().port}`;
  }
  const backend = express(); backend.use(express.json()); backend.use('/api/admin', automationRouter);
  process.env.AUTOMATION_SERVICE_URL = await listen(backend);
  const site = express(); site.use(express.json());
  site.use((req,res,next) => { req.user = { id: 1, is_admin: 1 }; next(); });
  site.use('/api/admin-operations', websiteRouter);
  const url = await listen(site);
  const post = (body, headers = {}) => fetch(url + '/api/admin-operations/growth-multiplier', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  const payload = { value: 2, confirm: 'TEST GROWTH', experimental: true };
  for (const value of [1,4,5,10,'2',null]) assert.equal((await post({ ...payload, value })).status, 400);
  assert.equal((await post({ ...payload, experimental: false })).status, 400);
  assert.equal((await post({ ...payload, confirm: 'SET GROWTH' })).status, 400);
  assert.equal((await post(payload, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  process.env.RCON_GROWTH_EXPERIMENTAL_ENABLED = 'false';
  assert.equal((await post(payload)).status, 503);
  assert.deepEqual(packets, []);
  process.env.RCON_GROWTH_EXPERIMENTAL_ENABLED = 'true';
  for (const value of [2,3]) {
    const response = await post({ ...payload, value });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.result.sent, true);
    assert.equal(body.result.confirmed, false);
    assert.equal(body.result.effectVerified, false);
    assert.equal(body.result.experimental, true);
    assert.match(body.result.warning, /No Game.ini change, automatic restoration or restart/);
  }
  assert.deepEqual(packets, ['02223200', '02223300']);
  assert.equal(store.listOutboxEvents({}).length, 0); // No false Discord announcement.
  const audit = store.listAudit({ category: 'rcon' });
  assert.ok(audit.some(row => row.details?.experimental === true));
  process.env.RCON_DISABLED = 'true';
  assert.equal((await post(payload)).status, 503);
  assert.equal(packets.length, 2);
});
