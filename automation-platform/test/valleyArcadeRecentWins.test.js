"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const express = require("express");
process.env.AUTOMATION_DB_PATH = ":memory:";
process.env.VALLEY_ARCADE_ENABLED = "1";
process.env.HOLLOW_VALLEY_API_TOKEN = "recent-wins-route-token";
const arcade = require("../src/services/valleyArcade");
const feed = require("../src/services/valleyArcadeRecentWins");
const rewards = require("../src/services/arcadeRewards");
const economy = require("../src/services/economyStore");
const db = economy.db;

arcade.configure("wins-admin", { enabled: true, emergency: false, cap: 250000 });

const PLAYER = "76561198000000401";
const OTHER = "76561198000000999";
const ALLOWED = new Set(["entries", "steamId", "type", "name", "rarity", "timestamp"]);
const SENTINELS = ["8675309", "424242", "leak@example.com", "203.0.113.10", OTHER, "Valley Coin", "payout", "odds", "wager"];

function pool(dropWeight) {
  return [
    { id: "coins", label: "500 Valley Coins", type: "coins", amount: 500, weight: 10000 - dropWeight },
    { id: "drop", label: "placeholder", type: "skin", weight: dropWeight }
  ];
}

function insert(row) {
  db.prepare(`INSERT INTO arcade_crates(id,steam_id,family,source,version,rewards_json,earned_at,opened_at,reward_json)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    row.id,
    row.steamId,
    row.family || "valley",
    row.source || "event",
    1,
    JSON.stringify(row.pool),
    row.openedAt ? row.openedAt - 1000 : 1,
    row.openedAt || null,
    row.reward ? JSON.stringify(row.reward) : null
  );
}

function keysOf(value, found = new Set()) {
  if (Array.isArray(value)) value.forEach(item => keysOf(item, found));
  else if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      found.add(key);
      keysOf(value[key], found);
    }
  }
  return found;
}

function assertPublic(payload) {
  const found = keysOf(payload);
  for (const key of found) assert.ok(ALLOWED.has(key), key);
  assert.ok(payload.entries.length <= 10);
  const body = JSON.stringify(payload);
  for (const secret of SENTINELS) assert.equal(body.includes(secret), false, secret);
  assert.doesNotMatch(body, /"xp"|"amount"|"weight"|"probability"|"email"|"ip"/);
  for (const entry of payload.entries) {
    assert.equal(entry.type, "crate");
    assert.match(entry.steamId, /^\d{17}$/);
    assert.match(entry.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.ok(["Rare", "Epic", "Legendary"].includes(entry.rarity));
  }
}

test("recent wins lists stored rare crate drops and nothing else", async (t) => {
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='arcade_rewards_config'").get(), undefined);
  feed.resetCache();
  assert.deepEqual(feed.recent(Date.parse("2026-11-26T00:00:00.000Z")), { entries: [] });
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='arcade_rewards_config'").get(), undefined);
  assert.equal(feed.rarityFor(400, 10000), "Rare");
  assert.equal(feed.rarityFor(200, 10000), "Epic");
  assert.equal(feed.rarityFor(100, 10000), "Legendary");
  assert.equal(feed.rarityFor(1000, 10000), "Rare");
  assert.equal(feed.rarityFor(1500, 10000), null);
  assert.equal(feed.rarityFor(8500, 10000), null);
  assert.equal(rewards.config().dailyPlays, 6);
  assert.equal(rewards.config().winXp, 75);
  assert.equal(rewards.config().xpPerLevel, 500);

  economy.ensureWallet(PLAYER);
  const balance = economy.getWallet(PLAYER).balance;
  const ledger = db.prepare("SELECT count(*) AS n FROM economy_wallet_ledger").get().n;
  db.prepare(`INSERT INTO economy_skin_presets(id,species,name,description,skin_json,price)
    VALUES ('arcade-emberwake-v1','Universal','Emberwake','leak@example.com 203.0.113.10 76561198000000999','{}',424242)`).run();

  const base = Date.parse("2026-11-20T00:00:00.000Z");
  for (let i = 0; i < 12; i++) {
    const steamId = "765611980000004" + String(i + 10);
    insert({
      id: "rare-" + String(i).padStart(2, "0"),
      steamId,
      openedAt: base + i * 1000,
      pool: pool(400),
      reward: {
        id: "skin",
        label: "8675309 Valley Coins",
        type: "skin",
        presetId: "arcade-emberwake-v1",
        weight: 400,
        amount: 8675309,
        xp: 75,
        email: "leak@example.com",
        ip: "203.0.113.10",
        payout: 500,
        odds: 0.04,
        wager: 1
      }
    });
  }
  insert({
    id: "same-time-a",
    steamId: PLAYER,
    openedAt: base + 500,
    pool: pool(200),
    reward: { id: "dino-a", label: "49% Carnotaurus entitlement", type: "dinosaur", species: "carnotaurus", growthPercent: 49, weight: 200, amount: 8675309 }
  });
  insert({
    id: "same-time-b",
    steamId: PLAYER,
    openedAt: base + 500,
    pool: pool(100),
    reward: { id: "dino-b", label: "75% Tyrannosaurus entitlement", type: "dinosaur", species: "tyrannosaurus", growthPercent: 75, weight: 100, amount: 8675309 }
  });
  insert({
    id: "common-skin",
    steamId: PLAYER,
    openedAt: base + 20000,
    pool: pool(5000),
    reward: { id: "common", label: "Common Hide", type: "skin", weight: 5000, amount: 8675309 }
  });
  insert({
    id: "uncommon-skin",
    steamId: PLAYER,
    openedAt: base + 19000,
    pool: pool(1500),
    reward: { id: "uncommon", label: "Uncommon Hide", type: "skin", weight: 1500, amount: 8675309 }
  });
  insert({
    id: "rare-coins",
    steamId: PLAYER,
    openedAt: base + 30000,
    pool: pool(50),
    reward: { id: "coins", label: "8675309 Valley Coins", type: "coins", amount: 8675309, weight: 50 }
  });
  insert({
    id: "unopened-craft",
    steamId: PLAYER,
    source: "fragments",
    pool: pool(400),
    reward: null
  });
  insert({
    id: "opened-craft",
    steamId: PLAYER,
    source: "fragments",
    openedAt: base + 18000,
    pool: pool(400),
    reward: { id: "crafted", label: "Frostveil skin", type: "skin", weight: 400 }
  });
  db.prepare("INSERT OR IGNORE INTO arcade_profiles(steam_id,xp) VALUES (?,?)").run(PLAYER, 5000);
  db.prepare(`INSERT INTO arcade_rewards_audit(actor,action,details_json,created_at) VALUES (?,?,?,?)`)
    .run(PLAYER, "game_reward", JSON.stringify({ roundId: "round", xp: 75, fragments: 1, email: "leak@example.com" }), base);

  feed.resetCache();
  const now = Date.parse("2026-11-26T01:00:00.000Z");
  const first = feed.recent(now);
  assertPublic(first);
  assert.equal(first.entries.length, 10);
  assert.equal(first.entries[0].name, "Frostveil skin");
  assert.equal(first.entries[0].type, "crate");
  assert.equal(first.entries[0].rarity, "Rare");
  assert.equal(first.entries[0].steamId, PLAYER);
  assert.equal(first.entries[0].timestamp, new Date(base + 18000).toISOString());
  assert.equal(first.entries[1].name, "Emberwake");
  assert.equal(first.entries[1].steamId, "76561198000000421");
  assert.equal(first.entries.some(entry => entry.steamId === "76561198000000410"), false);
  assert.equal(first.entries.some(entry => entry.steamId === "76561198000000411"), false);
  assert.equal(first.entries.some(entry => entry.name === "Common Hide" || entry.name === "Uncommon Hide"), false);
  assert.equal(economy.getWallet(PLAYER).balance, balance);
  assert.equal(db.prepare("SELECT count(*) AS n FROM economy_wallet_ledger").get().n, ledger);

  insert({
    id: "during-cache",
    steamId: PLAYER,
    openedAt: base + 40000,
    pool: pool(400),
    reward: { id: "cached", label: "Verdant Warden", type: "skin", weight: 400 }
  });
  const cached = feed.recent(now + 1000);
  assert.equal(cached.entries[0].name, "Frostveil skin");
  const fresh = feed.recent(now + feed.CACHE_MS);
  assert.equal(fresh.entries[0].name, "Verdant Warden");
  assert.equal(fresh.entries.length, 10);
  assertPublic(fresh);

  db.prepare("DELETE FROM arcade_crates").run();
  for (let i = 0; i < 15; i++) {
    insert({
      id: "newer-common-" + i,
      steamId: PLAYER,
      openedAt: base + 100000 + i,
      pool: pool(8000),
      reward: { id: "bulk", label: "Plain Hide", type: "skin", weight: 8000, amount: 8675309 }
    });
  }
  insert({
    id: "older-rare",
    steamId: PLAYER,
    openedAt: base + 10,
    pool: pool(75),
    reward: { id: "old", label: "25% Omniraptor entitlement", type: "dinosaur", species: "omniraptor", growthPercent: 25, weight: 75 }
  });
  insert({
    id: "older-rare-2",
    steamId: PLAYER,
    openedAt: base + 20,
    pool: pool(25),
    reward: { id: "old-2", label: "25% Triceratops entitlement", type: "dinosaur", species: "triceratops", growthPercent: 25, weight: 25 }
  });
  feed.resetCache();
  const scanned = feed.recent(now + feed.CACHE_MS * 2);
  assert.deepEqual(scanned.entries.map(entry => entry.name), ["25% Triceratops entitlement", "25% Omniraptor entitlement"]);
  assert.deepEqual(scanned.entries.map(entry => entry.rarity), ["Legendary", "Legendary"]);
  assert.equal(scanned.entries[0].timestamp > scanned.entries[1].timestamp, true);

  db.prepare("DELETE FROM arcade_crates").run();
  insert({
    id: "tie-a",
    steamId: PLAYER,
    openedAt: base + 5,
    pool: pool(400),
    reward: { id: "tie-a", label: "Earlier card", type: "skin", weight: 400 }
  });
  insert({
    id: "tie-b",
    steamId: PLAYER,
    openedAt: base + 5,
    pool: pool(400),
    reward: { id: "tie-b", label: "Later card", type: "skin", weight: 400 }
  });
  feed.resetCache();
  const ties = feed.recent(now + feed.CACHE_MS * 3);
  assert.deepEqual(ties.entries.map(entry => entry.name), ["Later card", "Earlier card"]);

  arcade.configure("wins-admin", { enabled: true, emergency: true, cap: 250000 });
  assert.throws(() => feed.recent(now), /disabled/);
  arcade.configure("wins-admin", { enabled: true, emergency: false, cap: 250000 });
  const paused = process.env.VALLEY_ARCADE_ENABLED;
  delete process.env.VALLEY_ARCADE_ENABLED;
  assert.throws(() => feed.recent(now), /disabled/);
  process.env.VALLEY_ARCADE_ENABLED = paused;

  const route = fs.readFileSync(require.resolve("../src/routes/websiteAdminWalletRoutes.js"), "utf8");
  const block = route.slice(route.indexOf("router.post('/arcade/:action'"), route.indexOf("router.post('/arcade-rewards/:action'"));
  assert.match(block, /valleyArcadeRecentWins'\)\.recent\(Date\.now\(\)\)/);
  assert.doesNotMatch(block, /body\.now|body\.reactionMs|body\.score|body\.opens|body\.payout|body\.amount/);
  const mounted = fs.readFileSync(require.resolve("../src/index.js"), "utf8");
  assert.match(mounted, /app\.use\('\/api\/valley-arcade'/);
  assert.match(mounted, /Cache-Control', 'private, no-store'/);
  const getRoute = fs.readFileSync(require.resolve("../src/routes/valleyArcadeRecentWinsRoutes.js"), "utf8");
  assert.match(getRoute, /router\.get\('\/recent-wins'/);
  assert.match(getRoute, /recentWins\.recent\(Date\.now\(\)\)/);
  assert.doesNotMatch(getRoute, /req\.body|req\.query|error\.message/);

  await t.test("GET /api/valley-arcade/recent-wins uses weekly auth and caps the list", async () => {
    db.prepare("DELETE FROM arcade_crates").run();
    for (let i = 0; i < 11; i++) {
      insert({
        id: "http-" + i,
        steamId: "765611980000005" + String(i).padStart(2, "0"),
        openedAt: base + 1000 * (i + 1),
        pool: pool(400),
        reward: {
          id: "http",
          label: "Emberwake skin",
          type: "skin",
          presetId: "arcade-emberwake-v1",
          weight: 400,
          amount: 8675309,
          email: "leak@example.com",
          ip: "203.0.113.10"
        }
      });
    }
    insert({
      id: "http-coins",
      steamId: PLAYER,
      openedAt: base + 999999,
      pool: pool(50),
      reward: { id: "coins", label: "8675309 Valley Coins", type: "coins", amount: 8675309, weight: 50 }
    });
    feed.resetCache();

    const app = express();
    app.use(express.json());
    app.use("/api/valley-arcade", require("../src/routes/valleyArcadeRecentWinsRoutes"));
    app.use("/api/website/admin-wallet", require("../src/routes/websiteAdminWalletRoutes"));
    const server = await new Promise(resolve => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    });
    t.after(() => new Promise(resolve => server.close(resolve)));
    const root = "http://127.0.0.1:" + server.address().port;
    const headers = { Authorization: "Bearer recent-wins-route-token", "Content-Type": "application/json" };

    assert.equal((await fetch(root + "/api/valley-arcade/recent-wins")).status, 401);
    assert.equal((await fetch(root + "/api/valley-arcade/recent-wins", { headers: { Authorization: "Bearer wrong" } })).status, 401);

    const live = await fetch(root + "/api/valley-arcade/recent-wins", { headers });
    assert.equal(live.status, 200);
    const payload = await live.json();
    assertPublic(payload);
    assert.equal(payload.entries.length, 10);
    assert.equal(payload.entries[0].name, "Emberwake");
    assert.equal(payload.entries[0].steamId, "76561198000000510");
    assert.equal(payload.entries.some(entry => entry.steamId === "76561198000000500"), false);
    assert.equal(payload.entries[0].timestamp > payload.entries[9].timestamp, true);

    const posted = await fetch(root + "/api/website/admin-wallet/arcade/recent-wins", {
      method: "POST",
      headers,
      body: JSON.stringify({
        steamId: OTHER,
        amount: 8675309,
        email: "leak@example.com",
        ip: "203.0.113.10",
        payout: 500,
        odds: 0.5,
        xp: 75,
        entries: [{ name: "Injected" }]
      })
    });
    assert.equal(posted.status, 200);
    const postedBody = await posted.json();
    assert.deepEqual(postedBody, payload);
    assert.equal(JSON.stringify(postedBody).includes("Injected"), false);

    db.prepare("DELETE FROM arcade_crates").run();
    feed.resetCache();
    const empty = await fetch(root + "/api/valley-arcade/recent-wins", { headers });
    assert.equal(empty.status, 200);
    assert.deepEqual(await empty.json(), { entries: [] });

    arcade.configure("wins-admin", { enabled: true, emergency: true, cap: 250000 });
    assert.equal((await fetch(root + "/api/valley-arcade/recent-wins", { headers })).status, 404);
    assert.equal((await fetch(root + "/api/website/admin-wallet/arcade/recent-wins", { method: "POST", headers, body: "{}" })).status, 404);
    arcade.configure("wins-admin", { enabled: false, emergency: false, cap: 250000 });
    assert.equal((await fetch(root + "/api/valley-arcade/recent-wins", { headers })).status, 404);
    arcade.configure("wins-admin", { enabled: true, emergency: false, cap: 250000 });
    delete process.env.VALLEY_ARCADE_ENABLED;
    assert.equal((await fetch(root + "/api/valley-arcade/recent-wins", { headers })).status, 404);
    assert.equal((await fetch(root + "/api/website/admin-wallet/arcade/recent-wins", { method: "POST", headers, body: "{}" })).status, 404);
    process.env.VALLEY_ARCADE_ENABLED = "1";
    assert.equal(rewards.config().dailyPlays, 6);
    assert.equal(rewards.config().winXp, 75);
    assert.equal(economy.getWallet(PLAYER).balance, balance);
  });
});
