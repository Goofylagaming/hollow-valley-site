"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomBytes, createHmac } = require("node:crypto");
// Each node:test file has a separate process. Never open developer/production DBs.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-legacy-http-"));
process.env.DB_PATH = path.join(dir, "website.sqlite");
process.env.AUTOMATION_DB_PATH = path.join(dir, "automation.sqlite");
process.env.VALLEY_LEGACY_ENABLED = "1";
process.env.NODE_ENV = "test";
process.env.HOLLOW_VALLEY_API_TOKEN = randomBytes(32).toString("hex");
process.env.AUTOMATION_ADMIN_TOKEN = randomBytes(32).toString("hex");
process.env.SESSION_SECRET = randomBytes(32).toString("hex");
const express = require("express");
const legacy = require("../automation-platform/src/services/valleyLegacyService");
const A = "76561198000000001",
  B = "76561198000000002";
async function listen(app) {
  const server = await new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
test("actual website session identity, CSRF, private reads and automation write boundary", async (t) => {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/website/legacy",
    require("../automation-platform/src/routes/valleyLegacyRoutes"),
  );
  const backend = await listen(app);
  process.env.AUTOMATION_SERVICE_URL = backend.url;
  const { createApp } = require("../server/index");
  const web = await listen(createApp());
  t.after(() => {
    backend.server.closeAllConnections();
    backend.server.close();
    web.server.closeAllConnections();
    web.server.close();
  });
  const { db } = require("../server/db");
  const result = db
    .prepare("INSERT INTO users(steam_id,username) VALUES (?,?)")
    .run(A, "Staging survivor");
  const sid = randomBytes(24).toString("hex");
  db.prepare("INSERT INTO sessions VALUES (?,?,?)").run(
    sid,
    JSON.stringify({
      userId: Number(result.lastInsertRowid),
      cookie: {
        originalMaxAge: 60000,
        expires: new Date(Date.now() + 60000).toISOString(),
        httpOnly: true,
        secure: false,
        sameSite: "lax",
      },
    }),
    Date.now() + 60000,
  );
  const signature = createHmac("sha256", process.env.SESSION_SECRET)
    .update(sid)
    .digest("base64")
    .replace(/=+$/, "");
  const cookie = `connect.sid=${encodeURIComponent(`s:${sid}.${signature}`)}`;
  assert.equal((await fetch(web.url + "/legacy")).status, 200);
  assert.equal((await fetch(web.url + "/api/legacy/me")).status, 401);
  assert.equal(
    (await fetch(backend.url + "/api/website/legacy/overview")).status,
    401,
  );
  assert.equal(
    (
      await fetch(backend.url + "/api/website/legacy/events", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.HOLLOW_VALLEY_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      })
    ).status,
    401,
  );
  const s = legacy.get();
  s.snapshot(
    [{ steamId: A, name: "Staging survivor", species: "Rex" }],
    Date.now(),
  );
  const parent = s.mine(A).lives[0].id;
  const request = {
    method: "POST",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ parent, eggs: 1, steamId: B, name: "Staging nest" }),
  };
  assert.equal(
    (await fetch(web.url + "/api/legacy/nests", request)).status,
    403,
  );
  request.headers["X-Valley-Legacy"] = "1";
  const response = await fetch(web.url + "/api/legacy/nests", request);
  assert.equal(response.status, 200);
  const nest = await response.json();
  assert.equal(s.mine(A).nests[0].id, nest.id);
  assert.equal(s.mine(B).nests.length, 0);
  assert.equal(
    (await fetch(web.url + "/api/legacy/me", { headers: { cookie } })).status,
    200,
  );
  assert.equal(db.prepare("PRAGMA quick_check").get().quick_check, "ok");
  assert.equal(s.db.prepare("PRAGMA quick_check").get().quick_check, "ok");
});
test("durable producer reconciliation imports only eligible coins and handles retries", () => {
  const s = legacy.get(),
    db = s.db;
  db.exec(
    "CREATE TABLE IF NOT EXISTS combat_events(id TEXT PRIMARY KEY,occurred_at TEXT,killer_steam_id TEXT,killer_name TEXT,victim_steam_id TEXT,victim_name TEXT); CREATE TABLE IF NOT EXISTS economy_wallet_ledger(id TEXT PRIMARY KEY,steam_id TEXT,amount INTEGER,kind TEXT,created_at TEXT)",
  );
  const at = new Date(Date.now() + 1).toISOString();
  db.prepare("INSERT INTO combat_events VALUES (?,?,?,?,?,?)").run(
    "test-combat",
    at,
    A,
    "A",
    B,
    "B",
  );
  for (const kind of [
    "playtime_reward",
    "event_reward",
    "admin_credit",
    "marketplace_sale",
    "refund",
    "daily_login_bonus",
  ])
    db.prepare("INSERT INTO economy_wallet_ledger VALUES (?,?,?,?,?)").run(
      kind,
      A,
      10,
      kind,
      at,
    );
  legacy.reconcile();
  legacy.reconcile();
  const rankings = s.overview().rankings.all;
  assert.equal(
    rankings.find((r) => r.metric === "gameplay_coins").leaders[0].value,
    20,
  );
  assert.equal(
    rankings.find((r) => r.metric === "kill_streak").leaders[0].value,
    1,
  );
  assert.equal(
    db
      .prepare("SELECT count(*) AS n FROM vl_events WHERE id LIKE 'combat:%'")
      .get().n,
    2,
  );
  db.prepare("DELETE FROM combat_events WHERE id='test-combat'").run();
  db.prepare("INSERT INTO combat_events VALUES (?,?,?,?,?,?)").run(
    "new-id",
    at,
    A,
    "A",
    B,
    "B",
  );
  legacy.reconcile();
  assert.equal(
    s.overview().rankings.all.find((r) => r.metric === "kill_streak").leaders[0]
      .value,
    2,
  );
});
