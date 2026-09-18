const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AUTOMATION_DB_PATH = ':memory:';
process.env.AUTOMATION_ADMIN_TOKEN = 'admin-restore-secret';

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
