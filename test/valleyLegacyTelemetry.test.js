"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
process.env.AUTOMATION_DB_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "legacy-feed-")),
  "automation.sqlite",
);
process.env.VALLEY_LEGACY_ENABLED = "1";
process.env.PLAYER_PRESENCE_ENABLED = "false";
process.env.WALLET_PLAYTIME_REWARDS_ENABLED = "false";
process.env.SUPPORTER_COIN_BONUSES_ENABLED = "false";
process.env.PRESENCE_FEED_TOKEN = randomBytes(32).toString("hex");
const legacy = require("../automation-platform/src/services/valleyLegacyService");
const store = legacy.get();
const express = require("express");
const app = express();
app.use(express.json());
app.use(
  "/snapshot",
  require("../automation-platform/src/routes/presenceFeedRoutes"),
);
test("authenticated presence feed reaches Legacy once; duplicate and stale telemetry do not award time", async (t) => {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const url = `http://127.0.0.1:${server.address().port}/snapshot/snapshot`;
  const at = Date.now(),
    steamId = "76561198000000004";
  const body = {
    sampleId: "legacy-feed-one",
    sampledAt: new Date(at).toISOString(),
    players: [
      {
        steamId,
        name: "Test survivor",
        species: "Rex",
        growth: 0.5,
        location: { x: 0, y: 0 },
      },
    ],
  };
  const post = (payload, token = process.env.PRESENCE_FEED_TOKEN) =>
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
  assert.equal((await post(body, "invalid")).status, 401);
  assert.equal((await post(body)).status, 201);
  const next = {
    ...body,
    sampleId: "legacy-feed-two",
    sampledAt: new Date(at + 60000).toISOString(),
  };
  assert.equal((await post(next)).status, 201);
  assert.equal((await post(next)).status, 200);
  const stale = { ...body, sampleId: "legacy-feed-old" };
  assert.equal((await post(stale)).status, 202);
  assert.equal(store.mine(steamId).mastery[0].seconds, 60);
});
