const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

process.env.DB_PATH = ":memory:";

const automation = require("../server/services/automationWebsiteClient");
const router = require("../server/routes/adminOperations");

function appFor(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user || null; next(); });
  app.use("/api/admin-operations", router);
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function baseUrl(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

test("Admin Operations routes require website admin access", async (t) => {
  for (const user of [null, { id: 1, is_admin: 0 }]) {
    const server = await listen(appFor(user));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const response = await fetch(`${baseUrl(server)}/api/admin-operations`);
    assert.equal(response.status, user ? 403 : 401);
  }
});

test("Admin Operations aggregates safe read-only automation state", async (t) => {
  const names = [
    "getAdminOperationsStatus", "getAdminMigrationReadiness", "getAdminBackupState",
    "getAdminServerHealth", "getAdminRequests", "getAdminAudit", "getAdminPresence",
  ];
  const originals = Object.fromEntries(names.map((name) => [name, automation[name]]));
  t.after(() => {
    for (const [name, fn] of Object.entries(originals)) automation[name] = fn;
  });

  automation.getAdminOperationsStatus = async () => ({ ok: true, server: { online: false }, requests: { pending: 0 } });
  automation.getAdminMigrationReadiness = async () => ({ readiness: { stage: "isolated-ready", checks: [] } });
  automation.getAdminBackupState = async () => ({ backups: { configured: true, count: 2 } });
  automation.getAdminServerHealth = async () => ({ analytics: { hours: 24, samples: 10, availabilityPercent: 90 } });
  automation.getAdminRequests = async () => ({ requests: [] });
  automation.getAdminAudit = async () => ({ audit: [] });
  automation.getAdminPresence = async () => ({ summary: { enabled: true }, sessions: [] });

  const server = await listen(appFor({ id: 1, is_admin: 1 }));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(`${baseUrl(server)}/api/admin-operations`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status.ok, true);
  assert.equal(body.status.server.online, false);
  assert.equal(body.readiness.readiness.stage, "isolated-ready");
  assert.equal(body.backups.backups.count, 2);
  assert.equal(body.health.analytics.availabilityPercent, 90);
});

test("Admin Operations backup endpoint is admin-only and proxies snapshot creation", async (t) => {
  const original = automation.createAdminBackup;
  automation.createAdminBackup = async () => ({
    ok: true,
    backup: { skipped: false, fileName: "automation-test.sqlite", size: 4096 },
  });
  t.after(() => { automation.createAdminBackup = original; });

  const server = await listen(appFor({ id: 1, is_admin: 1 }));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(`${baseUrl(server)}/api/admin-operations/backup`, { method: "POST" });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.backup.fileName, "automation-test.sqlite");
});
