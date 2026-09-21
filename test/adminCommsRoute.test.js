const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

process.env.DB_PATH = ":memory:";

const automation = require("../server/services/automationWebsiteClient");
const router = require("../server/routes/adminComms");

function appFor(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user || null; next(); });
  app.use("/api/admin-comms", router);
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function base(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

test("Admin Comms routes require website admin access", async (t) => {
  for (const user of [null, { id: 1, is_admin: 0 }]) {
    const server = await listen(appFor(user));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const response = await fetch(`${base(server)}/api/admin-comms`);
    assert.equal(response.status, user ? 403 : 401);
  }
});

test("Admin Comms loads Discord state and scheduled jobs", async (t) => {
  const originals = {
    getAdminDiscordState: automation.getAdminDiscordState,
    getAdminJobs: automation.getAdminJobs,
  };
  automation.getAdminDiscordState = async () => ({ configured: true, deliveryMode: "herbybot_outbox" });
  automation.getAdminJobs = async () => ({ summary: { scheduled: 1 }, jobs: [{ id: "job_12345678", status: "scheduled" }] });
  t.after(() => Object.assign(automation, originals));

  const server = await listen(appFor({ id: 1, is_admin: 1 }));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(`${base(server)}/api/admin-comms`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.discord.configured, true);
  assert.equal(body.jobs.summary.scheduled, 1);
});

test("Admin Comms validates and proxies immediate announcements", async (t) => {
  const original = automation.sendAdminDiscordAnnouncement;
  let sent = null;
  automation.sendAdminDiscordAnnouncement = async (message) => {
    sent = message;
    return { ok: true, announcement: { queued: true } };
  };
  t.after(() => { automation.sendAdminDiscordAnnouncement = original; });

  const server = await listen(appFor({ id: 1, is_admin: 1 }));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const rejected = await fetch(`${base(server)}/api/admin-comms/announce`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "   " }),
  });
  assert.equal(rejected.status, 400);

  const accepted = await fetch(`${base(server)}/api/admin-comms/announce`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Server update tonight" }),
  });
  assert.equal(accepted.status, 202);
  assert.equal(sent, "Server update tonight");
});

test("Admin Comms validates scheduling before automation call", async (t) => {
  const original = automation.scheduleAdminDiscordAnnouncement;
  let received = null;
  automation.scheduleAdminDiscordAnnouncement = async (payload) => {
    received = payload;
    return { ok: true, job: { id: "job_12345678", status: "scheduled" } };
  };
  t.after(() => { automation.scheduleAdminDiscordAnnouncement = original; });

  const server = await listen(appFor({ id: 1, is_admin: 1 }));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const runAt = new Date(Date.now() + 3600000).toISOString();
  const response = await fetch(`${base(server)}/api/admin-comms/schedule`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Daily reminder", runAt, recurrence: "daily" }),
  });
  assert.equal(response.status, 201);
  assert.equal(received.recurrence, "daily");
  assert.equal(received.runAt, runAt);
});
