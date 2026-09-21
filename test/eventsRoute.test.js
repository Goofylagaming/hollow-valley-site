const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

process.env.DB_PATH = ":memory:";

const db = require("../server/db");
const automation = require("../server/services/automationWebsiteClient");
const router = require("../server/routes/events");

function appFor(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user || null; next(); });
  app.use("/api/events", router);
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

test("personal event reward history requires login and a Steam link", async (t) => {
  const unauth = await listen(appFor(null));
  t.after(() => new Promise((resolve) => unauth.close(resolve)));
  let response = await fetch(`${base(unauth)}/api/events/rewards/mine`);
  assert.equal(response.status, 401);

  const noSteam = await listen(appFor({ id: 1, is_admin: 0, steam_id: null }));
  t.after(() => new Promise((resolve) => noSteam.close(resolve)));
  response = await fetch(`${base(noSteam)}/api/events/rewards/mine`);
  assert.equal(response.status, 400);
});

test("personal event reward history proxies only the signed-in Steam account", async (t) => {
  const original = automation.getEventRewards;
  let requested = null;
  automation.getEventRewards = async (steamId) => {
    requested = steamId;
    return { state: { enabled: false }, rewards: [{ amount: 500 }] };
  };
  t.after(() => { automation.getEventRewards = original; });

  const steamId = "76561198000000501";
  const server = await listen(appFor({ id: 1, is_admin: 0, steam_id: steamId }));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(`${base(server)}/api/events/rewards/mine`);
  assert.equal(response.status, 200);
  assert.equal(requested, steamId);
  const body = await response.json();
  assert.equal(body.rewards[0].amount, 500);
});

test("event reward admin player lookup exposes Steam-linked portal users only to admins", async (t) => {
  db.db.prepare("INSERT INTO users (steam_id, username, is_admin) VALUES (?, ?, 0)")
    .run("76561198000000502", "EventPlayer");

  const nonAdmin = await listen(appFor({ id: 2, is_admin: 0 }));
  t.after(() => new Promise((resolve) => nonAdmin.close(resolve)));
  let response = await fetch(`${base(nonAdmin)}/api/events/admin/players`);
  assert.equal(response.status, 403);

  const admin = await listen(appFor({ id: 3, is_admin: 1 }));
  t.after(() => new Promise((resolve) => admin.close(resolve)));
  response = await fetch(`${base(admin)}/api/events/admin/players?q=EventPlayer`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.players.length, 1);
  assert.equal(body.players[0].username, "EventPlayer");
  assert.equal(body.players[0].steamId, "76561198000000502");
});

test("admin event reward route proxies validated browser payload server-to-server", async (t) => {
  const original = automation.awardAdminEventReward;
  let received = null;
  automation.awardAdminEventReward = async (payload) => {
    received = payload;
    return {
      duplicate: false,
      baseAmount: 200,
      supporterMultiplier: 3,
      payoutAmount: 600,
    };
  };
  t.after(() => { automation.awardAdminEventReward = original; });

  const server = await listen(appFor({ id: 4, is_admin: 1 }));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(`${base(server)}/api/events/admin/reward`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      steamId: "76561198000000503",
      eventId: "discord-event-123",
      eventTitle: "Migration Night",
      baseAmount: 200,
    }),
  });

  assert.equal(response.status, 201);
  assert.deepEqual(received, {
    steamId: "76561198000000503",
    eventId: "discord-event-123",
    eventTitle: "Migration Night",
    baseAmount: 200,
  });
});
