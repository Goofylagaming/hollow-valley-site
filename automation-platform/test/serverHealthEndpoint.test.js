const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AUTOMATION_DB_PATH = ':memory:';
process.env.AUTOMATION_ADMIN_TOKEN = 'health-admin-secret';
process.env.SERVER_HEALTH_HISTORY_ENABLED = 'false';

const { app } = require('../src/index');

function listen() {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('server health history is admin-only and absent from public status', async (t) => {
  const server = await listen();
  t.after(() => close(server));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  const publicStatus = await fetch(`${base}/api/status`);
  assert.equal(publicStatus.status, 200);
  const publicBody = await publicStatus.json();
  assert.equal(Object.hasOwn(publicBody, 'healthHistory'), false);
  assert.equal(Object.hasOwn(publicBody, 'serverHealthAnalytics'), false);

  const denied = await fetch(`${base}/api/admin/server-health/analytics`);
  assert.equal(denied.status, 401);

  const allowed = await fetch(`${base}/api/admin/server-health/analytics?hours=24`, {
    headers: { Authorization: 'Bearer health-admin-secret' },
  });
  assert.equal(allowed.status, 200);
  const body = await allowed.json();
  assert.equal(body.analytics.enabled, false);
  assert.equal(body.analytics.hours, 24);
  assert.equal(body.analytics.samples, 0);
});
