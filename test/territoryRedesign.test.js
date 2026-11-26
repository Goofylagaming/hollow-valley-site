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
delete process.env.TERRITORY_WARS_PROTECTION_MINUTES;
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

function armCapture(at) {
  db.prepare(`
    UPDATE territory_holding_attacks
    SET status = 'active', contest_started_at = ?, last_tick_at = ?
    WHERE territory_key = 'south-plains' AND status IN ('warning', 'active')
  `).run(new Date(at - 3 * 60 * 1000).toISOString(), new Date(at - 60 * 1000).toISOString());
  db.prepare("UPDATE territory_holdings SET control_score = 96 WHERE territory_key = 'south-plains'").run();
  redesign.tick(at);
}

test("South Plains can be captured and an archived zone cannot be challenged", () => {
  delete process.env.TERRITORY_WARS_PROTECTION_MINUTES;
  seedGroup([[ownerA, "Alpha"], [mateA, "Ally"]], "Alpha Pack", "ALP");
  seedGroup([[ownerB, "Bravo"], [mateB, "Backup"]], "Bravo Pack", "BRV");
  redesign.setLineup(ownerA, "south-plains", [ownerA, mateA]);
  assert.throws(() => redesign.setLineup(ownerB, "swamp", [ownerB, mateB]), /Unknown territory/);
  redesign.declareAttack(ownerA, "south-plains", when - 6 * 60 * 1000);
  assert.throws(() => redesign.declareAttack(ownerB, "swamp", when - 6 * 60 * 1000), /Unknown territory/);
  const open = db.prepare("SELECT territory_key, status FROM territory_holding_attacks WHERE status IN ('warning','active')").all();
  assert.deepEqual(open.map((row) => row.territory_key), ["south-plains"]);

  armCapture(when);
  const plains = db.prepare("SELECT owner_hv_group_id, protection_until FROM territory_holdings WHERE territory_key = 'south-plains'").get();
  const owner = db.prepare("SELECT name FROM hv_groups WHERE id = ?").get(plains.owner_hv_group_id);
  assert.equal(owner.name, "Alpha Pack");
  assert.equal(plains.protection_until, new Date(when + 30 * 60 * 1000).toISOString());
  assert.equal(redesign.protectionMinutes({}), 30);
  assert.equal(redesign.protectionMinutes({ TERRITORY_WARS_PROTECTION_MINUTES: "0" }), 0);
  const state = redesign.publicState(when);
  assert.equal(state.holdings.length, 1);
  assert.equal(state.holdings[0].key, "south-plains");
  assert.equal(state.protectionMinutes, 30);
  assert.equal(state.event.protection_until, plains.protection_until);
});

test("default protection blocks a re-challenge for 30 minutes, then allows one in the same window", () => {
  delete process.env.TERRITORY_WARS_PROTECTION_MINUTES;
  redesign.setLineup(ownerB, "south-plains", [ownerB, mateB]);
  assert.throws(
    () => redesign.declareAttack(ownerB, "south-plains", when + 29 * 60 * 1000),
    /protected until/i
  );
  const attack = redesign.declareAttack(ownerB, "south-plains", when + 30 * 60 * 1000);
  assert.equal(attack.attack.status, "warning");
  assert.equal(attack.event.territory_key, "south-plains");
  const stillOpen = warWindowIsOpen(when + 30 * 60 * 1000);
  assert.equal(stillOpen, true);
});

function warWindowIsOpen(at) {
  return require("../server/services/territoryWindow").isOpen(at);
}

test("a live South Plains kill counts and an archived swamp kill does not", () => {
  const reopen = when + 30 * 60 * 1000;
  db.prepare(`
    UPDATE territory_holding_attacks
    SET status = 'active', starts_at = ?, contest_started_at = ?
    WHERE territory_key = 'south-plains' AND status = 'warning'
  `).run(new Date(reopen).toISOString(), new Date(reopen).toISOString());
  const insideSwamp = { x: 74000, y: 273000, z: 1 };
  const result = redesign.ingestCombat([
    {
      id: "kill-plains-1",
      occurredAt: new Date(reopen + 60 * 1000).toISOString(),
      killerSteamId: ownerB,
      victimSteamId: ownerA,
      killerLocation: center,
      victimLocation: center,
    },
    {
      id: "kill-swamp-1",
      occurredAt: new Date(reopen + 60 * 1000).toISOString(),
      killerSteamId: ownerB,
      victimSteamId: mateB,
      killerLocation: insideSwamp,
      victimLocation: insideSwamp,
    },
  ], reopen + 60 * 1000);
  assert.equal(result.counted, 1);
  const rows = db.prepare("SELECT territory_key, counted, reason FROM territory_holding_kills ORDER BY territory_key").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].territory_key, "south-plains");
  assert.equal(Number(rows[0].counted), 1);
  assert.equal(rows[0].reason, "counted");
});

function clearOpenAttacks(at) {
  db.prepare(`
    UPDATE territory_holding_attacks
    SET status = 'resolved', outcome = 'test-clear', resolved_at = ?
    WHERE status IN ('warning', 'active')
  `).run(new Date(at).toISOString());
}

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
    assert.equal(body.holdings.length, 1);
    assert.equal(body.holdings[0].key, "south-plains");
    assert.equal(body.redesign, true);
    const archived = await fetch(base + "/internal/attack", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer territory-test-secret" },
      body: JSON.stringify({ discordId: "9" + ownerB.slice(1), territoryKey: "swamp" }),
    });
    assert.equal(archived.status, 400);
    const archivedBody = await archived.json();
    assert.match(archivedBody.error, /Unknown territory/);
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

test("redesign admin preview lists the active zone catalog only", () => {
  const overlay = require("../server/services/territoryOverlayState");
  const listed = overlay._test.previewTerritories();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].key, "south-plains");
  const preview = overlay._test.buildAdminPreviewState({ is_admin: 1 }, "__all__");
  assert.deepEqual(preview.preview.territories, ["__all__", "South Plains"]);
  assert.equal(preview.preview.zones.length, 1);
  assert.equal(preview.preview.zones[0].territoryName, "South Plains");
  assert.equal(preview.preview.zones[0].claimRadiusMetres, 120);
  const archivedName = overlay._test.buildAdminPreviewState({ is_admin: 1 }, "Swamp");
  assert.equal(archivedName.preview.territoryName, "South Plains");
});

test("a successful defence protects the zone for the configured minutes", () => {
  delete process.env.TERRITORY_WARS_PROTECTION_MINUTES;
  const closed = Date.parse("2026-11-28T11:00:00.000Z");
  redesign.resetHoldings(when);
  clearOpenAttacks(when);
  const alpha = db.prepare("SELECT id FROM hv_groups WHERE name = 'Alpha Pack'").get();
  db.prepare(`
    UPDATE territory_holdings
    SET owner_hv_group_id = ?, protection_until = NULL, control_score = -100
    WHERE territory_key = 'south-plains'
  `).run(alpha.id);
  redesign.setLineup(ownerB, "south-plains", [ownerB, mateB]);
  redesign.declareAttack(ownerB, "south-plains", when);
  db.prepare("UPDATE territory_redesign_runtime SET open_window_key = ? WHERE id = 1").run("2026-11-28T09:00:00.000Z");
  redesign.tick(closed);
  const row = db.prepare("SELECT owner_hv_group_id, protection_until FROM territory_holdings WHERE territory_key = 'south-plains'").get();
  assert.equal(row.owner_hv_group_id, alpha.id);
  assert.equal(row.protection_until, new Date(closed + 30 * 60 * 1000).toISOString());
  const outcome = db.prepare("SELECT outcome FROM territory_holding_attacks WHERE territory_key = 'south-plains' ORDER BY id DESC LIMIT 1").get();
  assert.equal(outcome.outcome, "defence");
  assert.throws(
    () => redesign.declareAttack(ownerB, "south-plains", closed + 10 * 60 * 1000),
    /protected until/i
  );
  const again = redesign.declareAttack(ownerB, "south-plains", closed + 30 * 60 * 1000);
  assert.equal(again.attack.status, "warning");
});

test("zero protection minutes locks a capture until the next window", () => {
  process.env.TERRITORY_WARS_PROTECTION_MINUTES = "0";
  try {
    redesign.resetHoldings(when);
    clearOpenAttacks(when);
    redesign.setLineup(ownerA, "south-plains", [ownerA, mateA]);
    redesign.declareAttack(ownerA, "south-plains", when - 6 * 60 * 1000);
    armCapture(when);
    const plains = db.prepare("SELECT protection_until FROM territory_holdings WHERE territory_key = 'south-plains'").get();
    assert.equal(plains.protection_until, "2026-12-05T09:00:00.000Z");
    assert.throws(
      () => redesign.declareAttack(ownerB, "south-plains", when + 60 * 60 * 1000),
      /protected until/i
    );
  } finally {
    delete process.env.TERRITORY_WARS_PROTECTION_MINUTES;
  }
});
