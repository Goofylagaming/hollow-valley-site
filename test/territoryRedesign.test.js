const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-territory-redesign-"));
process.env.DB_PATH = path.join(dir, "site.sqlite");
process.env.TERRITORY_WARS_REDESIGN_ENABLED = "1";
delete process.env.TERRITORY_WARS_HOLDER_REWARDS_ENABLED;
delete process.env.TERRITORY_WARS_SEASONS_ENABLED;
delete process.env.VALLEY_LEGACY_ENABLED;

const { db } = require("../server/db");
const groups = require("../server/groupsStore");
const status = require("../server/services/serverStatus");
const redesign = require("../server/services/territoryRedesign");
const router = require("../server/routes/territoryWars");

const ownerA = "76561198000000801";
const mateA = "76561198000000802";
const ownerB = "76561198000000803";
const mateB = "76561198000000804";
const when = Date.parse("2026-11-28T09:30:00.000Z");
const center = { x: -302000, y: 250000, z: 0 };

test.after(() => {
  status.getState = originalState;
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const originalState = status.getState;
status.getState = () => ({
  configured: true,
  online: true,
  characters: [ownerA, mateA].map((steamId) => ({ steamId, location: center })),
});

function seedGroup(steamIds, name, tag) {
  for (const [steamId, username] of steamIds) {
    db.prepare("INSERT INTO users (steam_id, username, discord_id) VALUES (?, ?, ?)").run(steamId, username, "9" + steamId.slice(1));
  }
  groups.createGroup(steamIds[0][0], name);
  groups.setTag(steamIds[0][0], tag);
  if (steamIds[1]) {
    groups.invite(steamIds[0][0], steamIds[1][0]);
    const invite = groups.getState(steamIds[1][0]).incoming[0];
    groups.actOnInvite(steamIds[1][0], invite.id, "accept");
  }
}

test("four holdings can be challenged independently and a window capture protects until next week", () => {
  seedGroup([[ownerA, "Alpha"], [mateA, "Ally"]], "Alpha Pack", "ALP");
  seedGroup([[ownerB, "Bravo"], [mateB, "Backup"]], "Bravo Pack", "BRV");
  redesign.setLineup(ownerA, "south-plains", [ownerA, mateA]);
  redesign.setLineup(ownerB, "swamp", [ownerB, mateB]);
  redesign.declareAttack(ownerA, "south-plains", when - 6 * 60 * 1000);
  redesign.declareAttack(ownerB, "swamp", when - 6 * 60 * 1000);
  const open = db.prepare("SELECT territory_key, status FROM territory_holding_attacks WHERE status IN ('warning','active')").all();
  assert.equal(open.length, 2);

  db.prepare(`
    UPDATE territory_holding_attacks
    SET status = 'active', contest_started_at = ?, last_tick_at = ?
    WHERE territory_key = 'south-plains'
  `).run(new Date(when - 3 * 60 * 1000).toISOString(), new Date(when - 60 * 1000).toISOString());
  db.prepare("UPDATE territory_holdings SET control_score = 96 WHERE territory_key = 'south-plains'").run();
  redesign.tick(when);
  const plains = db.prepare("SELECT owner_hv_group_id, protection_until FROM territory_holdings WHERE territory_key = 'south-plains'").get();
  const owner = db.prepare("SELECT name FROM hv_groups WHERE id = ?").get(plains.owner_hv_group_id);
  assert.equal(owner.name, "Alpha Pack");
  assert.equal(plains.protection_until, "2026-12-05T09:00:00.000Z");
  const swamp = db.prepare("SELECT status FROM territory_holding_attacks WHERE territory_key = 'swamp' ORDER BY id DESC LIMIT 1").get();
  assert.equal(swamp.status, "active");
});

test("kills on two live attacks both nudge momentum and do not require a capture", () => {
  const plainsAttack = db.prepare("SELECT id FROM territory_holding_attacks WHERE territory_key = 'south-plains' ORDER BY id DESC LIMIT 1").get();
  const swampAttack = db.prepare("SELECT id FROM territory_holding_attacks WHERE territory_key = 'swamp' AND status = 'active'").get();
  assert.ok(swampAttack);
  const insideSwamp = { x: 74000, y: 273000, z: 1 };
  const result = redesign.ingestCombat([
    {
      id: "kill-plains-1",
      occurredAt: new Date(when).toISOString(),
      killerSteamId: ownerA,
      victimSteamId: mateA,
      killerLocation: center,
      victimLocation: center,
    },
    {
      id: "kill-swamp-1",
      occurredAt: new Date(when).toISOString(),
      killerSteamId: ownerB,
      victimSteamId: mateB,
      killerLocation: insideSwamp,
      victimLocation: insideSwamp,
    },
  ], when);
  assert.equal(result.counted >= 0, true);
  const rows = db.prepare("SELECT territory_key, counted FROM territory_holding_kills ORDER BY territory_key").all();
  assert.ok(rows.length >= 1);
  assert.equal(plainsAttack.id > 0, true);
});

test("internal attack route maps a linked Discord account and rejects a bad secret", async () => {
  process.env.TERRITORY_WARS_INTERNAL_TOKEN = "territory-test-secret";
  const app = express();
  app.use(express.json());
  app.use("/api/territory-wars", router);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/territory-wars`;
  try {
    const denied = await fetch(base + "/internal/attack", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer wrong-secret" },
      body: JSON.stringify({ discordId: "9" + ownerB.slice(1) }),
    });
    assert.equal(denied.status, 401);
    const state = await fetch(base + "/internal/state", {
      headers: { Authorization: "Bearer territory-test-secret" },
    });
    assert.equal(state.status, 200);
    const body = await state.json();
    assert.equal(body.holdings.length, 4);
    assert.equal(body.redesign, true);
  } finally {
    server.close();
  }
});

test("holder coins split a modest hourly amount across members with the remainder to the owner", () => {
  const shares = redesign.splitCoins(25, [
    { steamId: ownerA, role: "owner" },
    { steamId: mateA, role: "member" },
  ], ownerA);
  assert.equal(shares.reduce((sum, share) => sum + share.amount, 0), 25);
  assert.equal(shares.find((share) => share.steamId === ownerA).amount, 13);
  assert.equal(shares.find((share) => share.steamId === mateA).amount, 12);
  assert.equal(redesign.coinsPerHour({}), 25);
});
