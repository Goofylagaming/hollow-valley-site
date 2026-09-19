const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

process.env.DB_PATH = ":memory:";
process.env.HOLLOW_VALLEY_API_TOKEN = "supporter-internal-secret";

const { db } = require("../server/db");
require("../server/services/supporterWebhook");
const router = require("../server/routes/supporterInternal");

function reset() {
  db.exec("DELETE FROM stripe_webhook_events; DELETE FROM supporter_subscriptions; DELETE FROM users;");
  const insertUser = db.prepare("INSERT INTO users (id, steam_id, username) VALUES (?, ?, ?)");
  insertUser.run(41, "76561198000000041", "member-active");
  insertUser.run(42, "76561198000000042", "elite-trial");
  insertUser.run(43, "76561198000000043", "legend-past-due");

  const insertMembership = db.prepare(`
    INSERT INTO supporter_subscriptions
      (user_id, tier, auto_renew, stripe_status)
    VALUES (?, ?, 1, ?)
  `);
  insertMembership.run(41, "member", "active");
  insertMembership.run(42, "elite", "trialing");
  insertMembership.run(43, "legend", "past_due");
}

function listen() {
  const app = express();
  app.use(express.json());
  app.use("/api/internal/supporter-memberships", router);
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("internal supporter lookup is token protected and returns only entitled tiers", async (t) => {
  reset();
  const server = await listen();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/internal/supporter-memberships`;

  const denied = await fetch(base, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ steamIds: ["76561198000000041"] }),
  });
  assert.equal(denied.status, 401);

  const response = await fetch(base, {
    method: "POST",
    headers: {
      Authorization: "Bearer supporter-internal-secret",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      steamIds: [
        "76561198000000041",
        "76561198000000042",
        "76561198000000043",
        "76561198000000044",
        "76561198000000041",
      ],
    }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    memberships: [
      { steamId: "76561198000000041", entitled: true, tier: "member" },
      { steamId: "76561198000000042", entitled: true, tier: "elite" },
      { steamId: "76561198000000043", entitled: false, tier: null },
      { steamId: "76561198000000044", entitled: false, tier: null },
    ],
  });
});

test("internal supporter lookup rejects malformed Steam IDs", async (t) => {
  reset();
  const server = await listen();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/internal/supporter-memberships`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer supporter-internal-secret",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ steamIds: ["not-a-steam-id"] }),
  });
  assert.equal(response.status, 400);
});
