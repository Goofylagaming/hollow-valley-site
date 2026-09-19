const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

process.env.DB_PATH = ":memory:";

const automation = require("../server/services/automationWebsiteClient");
const router = require("../server/routes/adminRestore");

function appFor(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user || null; next(); });
  app.use("/api/admin-restore", router);
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("Admin Restore routes require website admin access", async (t) => {
  for (const user of [null, { id: 1, is_admin: 0 }]) {
    const server = await listen(appFor(user));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin-restore`);
    assert.equal(response.status, user ? 403 : 401);
  }
});

test("Admin Restore state is proxied only after admin auth", async (t) => {
  const original = automation.getAdminRestoreState;
  automation.getAdminRestoreState = async () => ({
    adminRestore: { builderReady: true, writeEnabled: false, ftpConfigured: true },
  });
  t.after(() => { automation.getAdminRestoreState = original; });

  const server = await listen(appFor({ id: 1, is_admin: 1 }));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin-restore`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    adminRestore: { builderReady: true, writeEnabled: false, ftpConfigured: true },
  });
});

test("Admin Restore upload validates Steam ID before automation write", async (t) => {
  const original = automation.uploadAdminRestore;
  let calls = 0;
  automation.uploadAdminRestore = async () => { calls += 1; return {}; };
  t.after(() => { automation.uploadAdminRestore = original; });

  const server = await listen(appFor({ id: 1, is_admin: 1 }));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin-restore/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ steamId: "bad", slot: "restore", restore: { classPath: "/Game/Test" } }),
  });
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
});
