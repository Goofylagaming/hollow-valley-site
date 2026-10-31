const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.AUTOMATION_DB_PATH = ':memory:';
process.env.AUTOMATION_ADMIN_TOKEN = 'growth-test-private-token';

const rcon = require('../src/services/rconControlService');
const router = require('../src/routes/adminRoutes');

function listen() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', router);
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('automation growth endpoint authenticates and confirms before writing', async (t) => {
  const original = rcon.execute;
  const commands = [];
  rcon.execute = async (action, payload) => {
    commands.push({ action, payload });
    return { action, sent: true, confirmed: false, warning: 'No RCON response' };
  };
  t.after(() => { rcon.execute = original; });
  const server = await listen();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/admin/rcon/growth-multiplier`;

  async function post(value, confirm, authorized = true) {
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authorized ? { Authorization: 'Bearer growth-test-private-token' } : {}),
      },
      body: JSON.stringify({ value, confirm, experimental: true }),
    });
  }

  assert.equal((await post(3, 'TEST GROWTH', false)).status, 401);
  assert.equal((await post(3, 'invalid')).status, 400);
  assert.deepEqual(commands, []);
  const response = await post(3, 'TEST GROWTH');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.result.sent, true);
  assert.equal(body.result.confirmed, false);
  assert.deepEqual(commands, [{ action: 'growthMultiplier', payload: { value: 3, confirm: 'TEST GROWTH', experimental: true } }]);
});
