const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

process.env.DB_PATH = ":memory:";
const { db } = require("../server/db");
const automation = require("../server/services/automationWebsiteClient");
const router = require("../server/routes/adminOperations");

async function request(user, path) {
  const app = express();
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use("/api/admin-operations", router);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin-operations${path}`);
    return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control") };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("player records require an admin and a valid Steam ID", async () => {
  const path = "/player-records/76561198038977506";
  assert.equal((await request(null, path)).status, 401);
  assert.equal((await request({ id: 1, is_admin: 0 }, path)).status, 403);
  assert.equal((await request({ id: 1, is_admin: 1 }, "/player-records/abc")).status, 400);
});

test("admin sees last in-game name with the requested Steam ID, dinos, and wallet history", async (t) => {
  const steamId = "76561198038977506";
  db.prepare("INSERT INTO users (steam_id, username) VALUES (?, ?)").run(steamId, "WebsiteName");
  const originals = {
    getAdminPresence: automation.getAdminPresence,
    listStoredDinos: automation.listStoredDinos,
    getWallet: automation.getWallet,
  };
  t.after(() => Object.assign(automation, originals));
  automation.getAdminPresence = async (options) => {
    assert.deepEqual(options, { steamId, limit: 1 });
    return { sessions: [{ player_name: "InGameName" }] };
  };
  automation.listStoredDinos = async (id) => {
    assert.equal(id, steamId);
    return { dinos: [{ slot: "slot1", species: "Triceratops" }] };
  };
  automation.getWallet = async (id) => {
    assert.equal(id, steamId);
    return { balance: 150, transactions: [{ amount: 50, kind: "playtime_reward" }] };
  };
  const result = await request({ id: 1, is_admin: 1 }, `/player-records/${steamId}`);
  assert.equal(result.status, 200);
  assert.equal(result.cache, "no-store");
  assert.deepEqual(result.body.player, { steamId, name: "InGameName" });
  assert.equal(result.body.dinos[0].species, "Triceratops");
  assert.equal(result.body.wallet.transactions[0].amount, 50);

  automation.getAdminPresence = async () => ({ sessions: [] });
  automation.listStoredDinos = async () => { throw new Error("Private bridge details"); };
  const partial = await request({ id: 1, is_admin: 1 }, `/player-records/${steamId}`);
  assert.equal(partial.body.player.name, "WebsiteName");
  assert.equal(partial.body.dinos, null);
  assert.equal(partial.body.dinosError, "Stored dinos could not be loaded.");
  assert.equal(partial.body.wallet.balance, 150);
});
