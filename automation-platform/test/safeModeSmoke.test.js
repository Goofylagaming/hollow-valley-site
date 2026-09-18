const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AUTOMATION_DB_PATH = ':memory:';
process.env.AUTOMATION_ADMIN_TOKEN = 'smoke-admin-secret';
process.env.HOLLOW_VALLEY_API_TOKEN = 'smoke-website-secret';
process.env.RCON_WRITE_ENABLED = 'false';
process.env.COMMAND_BRIDGE_ENABLED = 'false';
process.env.ADMIN_RESTORE_WRITE_ENABLED = 'false';
delete process.env.RCON_HOST;
delete process.env.RCON_PORT;
delete process.env.RCON_PASSWORD;

const { app } = require('../src/index');

function listen() {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('safe-mode boot keeps reads available and all game writes fail closed', async (t) => {
  const server = await listen();
  t.after(() => close(server));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(healthBody.ok, true);
  assert.equal(healthBody.storage.databasePersistent, false);
  assert.equal(typeof healthBody.storage.initializedAt, 'string');

  const healthAgain = await fetch(`${base}/health`);
  const healthAgainBody = await healthAgain.json();
  assert.equal(healthAgainBody.storage.initializedAt, healthBody.storage.initializedAt);

  const publicStatus = await fetch(`${base}/api/status`);
  assert.equal(publicStatus.status, 200);
  const statusBody = await publicStatus.json();
  assert.equal(statusBody.server.online, false);

  const rconWrite = await fetch(`${base}/api/admin/rcon/announce`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer smoke-admin-secret',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: 'test' }),
  });
  assert.equal(rconWrite.status, 503);
  assert.match((await rconWrite.json()).error, /disabled/i);

  const restoreUpload = await fetch(`${base}/api/admin/dinostorage/admin-restore/upload`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer smoke-admin-secret',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      steamId: '76561198000000001',
      slot: 'admin_restore_test',
      restore: {
        classPath: '/Game/Test/BP_Test.BP_Test_C',
        growth: 0.5,
      },
      fullNutrients: true,
    }),
  });
  assert.equal(restoreUpload.status, 503);
  assert.match((await restoreUpload.json()).error, /disabled/i);

  const bodyDrop = await fetch(`${base}/api/website/bodydrop`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer smoke-website-secret',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      steamId: '76561198000000001',
      dropType: 'small',
    }),
  });
  assert.equal(bodyDrop.status, 503);

  const dinoStore = await fetch(`${base}/api/website/dinostorage/store`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer smoke-website-secret',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      steamId: '76561198000000002',
      slot: 'dino-smoke-test',
    }),
  });
  assert.equal(dinoStore.status, 502);
  assert.match((await dinoStore.json()).error, /CommandBridge|publishing|enabled/i);
});
