const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AUTOMATION_DB_PATH = ':memory:';
process.env.AUTOMATION_ADMIN_TOKEN = 'admin-restore-secret';
process.env.ADMIN_RESTORE_WRITE_ENABLED = 'false';

const { app } = require('../src/index');

function listen() {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('admin restore JSON builder is protected and preserves explicit nutrients', async (t) => {
  const server = await listen();
  t.after(() => close(server));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const restore = {
    version: 2,
    slot: 'admin_restore_test',
    classPath: '/Game/TheIsle/Core/Characters/Dinosaurs/Triceratops/BP_Triceratops.BP_Triceratops_C',
    growth: 0.76,
    nutrients: {
      carbValue: 11,
      proteinValue: 22,
      lipidValue: 33,
      bMalnutrition: true,
    },
  };

  const denied = await fetch(`${base}/api/admin/dinostorage/admin-restore-json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ restore, fullNutrients: true }),
  });
  assert.equal(denied.status, 401);

  const allowed = await fetch(`${base}/api/admin/dinostorage/admin-restore-json`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer admin-restore-secret',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ restore, fullNutrients: true }),
  });
  assert.equal(allowed.status, 200);

  const body = await allowed.json();
  assert.equal(body.restore.fullNutrients, true);
  assert.deepEqual(body.restore.state.nutrients, restore.nutrients);
  assert.equal(body.restore.state.fullNutrients, true);
  assert.match(body.restore.json, /"fullNutrients": true/);
});

test('admin restore endpoint rejects invalid growth before producing JSON', async (t) => {
  const server = await listen();
  t.after(() => close(server));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/api/admin/dinostorage/admin-restore-json`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer admin-restore-secret',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      restore: {
        classPath: '/Game/Test/BP_Test.BP_Test_C',
        growth: 4,
      },
      fullNutrients: true,
    }),
  });

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /growth must be at most 1/);
});


test('admin restore status exposes the write gate without exposing secrets', async (t) => {
  const server = await listen();
  t.after(() => close(server));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/api/admin/dinostorage/admin-restore`, {
    headers: { Authorization: 'Bearer admin-restore-secret' },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.adminRestore.builderReady, true);
  assert.equal(body.adminRestore.writeEnabled, false);
  assert.equal(Object.hasOwn(body.adminRestore, 'password'), false);
  assert.equal(Object.hasOwn(body.adminRestore, 'token'), false);
});

test('admin restore slot upload fails closed while write gate is disabled', async (t) => {
  const server = await listen();
  t.after(() => close(server));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/api/admin/dinostorage/admin-restore/upload`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer admin-restore-secret',
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

  assert.equal(response.status, 503);
  const body = await response.json();
  assert.match(body.error, /disabled/i);
});
