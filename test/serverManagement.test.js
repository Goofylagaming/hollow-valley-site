"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { scryptSync } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

process.env.DB_PATH = ":memory:";
process.env.OWNER_STEAM_ID = "76561198038977506";
process.env.SESSION_SECRET = "owner-management-test-session-secret";
process.env.HV_MANAGEMENT_ENABLED = "1";
process.env.HV_MANAGEMENT_WRITES_ENABLED = "1";
process.env.HV_MANAGEMENT_AGENT_TOKEN = "test-only-management-token-64-characters-not-a-production-secret";

const { db } = require("../server/db");
const { createApp } = require("../server/index");

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}
function base(server) { return "http://127.0.0.1:" + server.address().port; }
async function ownerCookie(url) {
  const password = "owner-management-safe-test-password";
  const salt = "owner-management-test-salt";
  db.prepare("INSERT OR IGNORE INTO users (steam_id, username, is_admin) VALUES (?,?,1)")
    .run(process.env.OWNER_STEAM_ID, "Owner");
  db.prepare("INSERT OR REPLACE INTO owner_logins (steam_id,email,password_salt,password_hash,session_version) VALUES (?,?,?,?,?)")
    .run(process.env.OWNER_STEAM_ID, "management-owner@example.com", salt,
      scryptSync(password, salt, 64).toString("hex"), "management-owner-version");
  const res = await fetch(url + "/auth/owner/login", {
    method: "POST",
    headers: { Origin: url, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "management-owner@example.com", password }),
  });
  assert.equal(res.status, 200, "owner login");
  return res.headers.get("set-cookie").split(";")[0];
}
function agentHeaders(token = process.env.HV_MANAGEMENT_AGENT_TOKEN) {
  return { Authorization: "Bearer " + token, "Content-Type": "application/json" };
}

test("management page and APIs are private, bounded, and each job is executed at most once", async (t) => {
  const server = await listen(createApp());
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = base(server);

  for (const route of ["/admin/server", "/admin/server/", "/api/admin/server-management"]) {
    assert.equal((await fetch(url + route)).status, 404, route);
  }
  assert.equal((await fetch(url + "/api/binarylane-management/next")).status, 401);
  assert.equal((await fetch(url + "/api/binarylane-management/next", {
    headers: agentHeaders("bad-token"),
  })).status, 401);

  const cookie = await ownerCookie(url);
  const page = await fetch(url + "/admin/server", { headers: { Cookie: cookie } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Server management/);
  const overview = await fetch(url + "/api/admin/server-management", { headers: { Cookie: cookie } });
  assert.equal(overview.status, 200);
  assert.equal((await overview.json()).connected, false);

  const endpoint = url + "/api/admin/server-management/jobs";
  const action = (target, confirmation, extraHeaders = {}) => fetch(endpoint, {
    method: "POST",
    headers: {
      Cookie: cookie, Origin: url, "Content-Type": "application/json",
      "X-HV-Owner-Action": "enable-start-v1", ...extraHeaders,
    },
    body: JSON.stringify({ action: "enable_start", target, confirmation }),
  });

  assert.equal((await action("command_bridge", "ENABLE command_bridge")).status, 409,
    "cannot queue when agent is offline");
  const status = await fetch(url + "/api/binarylane-management/status", {
    method: "POST", headers: agentHeaders(),
    body: JSON.stringify({
      agentVersion: "v0.1",
      server: { pid: 9560, processCount: 1, rconOwnedByGame: true },
      tasks: {
        watchdog: "Running", scheduled_restart: "Ready",
        command_bridge: "Ready", combat_forwarder: "Running",
        legacy_combat_forwarder: "Disabled",
      },
      logs: { restart: ["Save completed"], forwarder: ["Log connected"] },
    }),
  });
  assert.equal(status.status, 200);
  assert.equal((await action("watchdog", "ENABLE watchdog")).status, 400,
    "watchdog is never a write target");
  assert.equal((await action("command_bridge", "WRONG")).status, 400);
  assert.equal((await action("command_bridge", "ENABLE command_bridge", { Origin: "http://evil.example" })).status, 403);
  assert.equal((await fetch(endpoint, {
    method: "POST",
    headers: { Cookie: cookie, Origin: url, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "enable_start", target: "command_bridge" }),
  })).status, 403, "custom request header is required");

  const accepted = await action("command_bridge", "ENABLE command_bridge");
  assert.equal(accepted.status, 202);
  const queuedJob = (await accepted.json()).job;
  assert.equal(queuedJob.state, "queued");
  assert.equal(queuedJob.leaseToken, undefined, "never disclose agent lease to browser");
  assert.equal((await action("command_bridge", "ENABLE command_bridge")).status, 409,
    "pending duplicate action blocked");

  const pull = await fetch(url + "/api/binarylane-management/next", {
    headers: agentHeaders(),
  });
  assert.equal(pull.status, 200);
  const leased = (await pull.json()).job;
  assert.equal(leased.id, queuedJob.id);
  assert.match(leased.leaseToken, /^[0-9a-f]{48}$/);

  assert.equal((await (await fetch(url + "/api/binarylane-management/next", {
    headers: agentHeaders(),
  })).json()).job, null, "no duplicate delivery");

  const ackUrl = url + "/api/binarylane-management/jobs/" + leased.id + "/result";
  const ack = (leaseToken) => fetch(ackUrl, {
    method: "POST", headers: agentHeaders(),
    body: JSON.stringify({ leaseToken, state: "succeeded", message: "Task enabled and started" }),
  });
  assert.equal((await ack("0".repeat(48))).status, 409);
  assert.equal((await ack(leased.leaseToken)).status, 200);
  assert.equal((await ack(leased.leaseToken)).status, 409, "results accepted exactly once");

  const after = await fetch(url + "/api/admin/server-management", { headers: { Cookie: cookie } });
  const state = await after.json();
  assert.equal(state.connected, true);
  assert.equal(state.snapshot.server.pid, 9560);
  assert.equal(state.jobs[0].state, "succeeded");
  assert.equal(state.jobs[0].leaseToken, undefined);
  assert.equal((await action("command_bridge", "ENABLE command_bridge")).status, 429,
    "rapid replay is blocked");
});

test("management agent source cannot execute arbitrary commands or restart game", () => {
  const script = fs.readFileSync(path.join(__dirname, "..", "scripts/windows/HollowValley-ServerManagementAgent.ps1"), "utf8");
  assert.match(script, /enable_start/);
  assert.match(script, /command_bridge/);
  assert.match(script, /combat_forwarder/);
  assert.doesNotMatch(script, /Invoke-Expression|Stop-Process|Restart-Computer|Set-Content.*Game\.ini/i);
});
