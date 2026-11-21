const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-territory-combat-api-"));
process.env.AUTOMATION_DB_PATH = path.join(dir, "automation.sqlite");
process.env.COMBAT_FEED_ENABLED = "true";
process.env.COMBAT_FEED_TOKEN = "combat-token";
process.env.HOLLOW_VALLEY_API_TOKEN = "website-token";

const combat = require("../src/services/combatEventService");
const route = require("../src/routes/websiteTerritoryCombatRoutes");

test.after(() => {
  combat._test.db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("territory combat feed returns stored kill coordinates", async () => {
  const occurredAt = new Date(Date.now() - 60000).toISOString();
  combat.ingestEvent({
    eventId: "islelog:testkill01",
    occurredAt,
    killerSteamId: "76561198000000401",
    killerName: "Hunter",
    victimSteamId: "76561198000000402",
    victimName: "Target",
    victimSpecies: "Diabloceratops",
    killerLocation: { x: -302000, y: 250000, z: 12 },
    victimLocation: { x: -302000, y: 250000, z: 12 },
  }, { env: process.env });

  const app = express();
  app.use("/api/website/territory-combat", route);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  try {
    const denied = await fetch(`http://127.0.0.1:${server.address().port}/api/website/territory-combat/events`);
    assert.equal(denied.status, 401);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/website/territory-combat/events?since=${encodeURIComponent(new Date(Date.now() - 120000).toISOString())}`, {
      headers: { Authorization: "Bearer website-token" },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.events[0].id, "islelog:testkill01");
    assert.equal(body.events[0].killerLocation.x, -302000);
    assert.equal(body.events[0].victimLocation.y, 250000);
  } finally {
    server.close();
  }
});
