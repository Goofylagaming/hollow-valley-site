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
process.env.DYNAMIC_CHALLENGES_ENABLED = "1";
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
  store.challenges.change(steamId,{selected:true,expectedRevision:0,requestKey:'telemetry-enroll-0001'});
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
  assert.equal(store.challenges.status(steamId).challenges[1].progress,1);
  assert.equal(store.db.prepare('SELECT at FROM dc_cursor WHERE steam_id=?').get(steamId).at,at+60000);

  // Exercise intake, the saved website snapshot and Legacy together. Unknown
  // growth cannot establish a juvenile milestone before a later adult sample.
  const unknownValues=[null,'','  ',true,false,[],{},'NaN',undefined];
  const unknownPlayers=unknownValues.map((value,index)=>({
    steamId:String(76561198000000100n+BigInt(index)),name:'Unknown telemetry',
    species:'Triceratops',growth:value,health:value,stamina:value,hunger:value,thirst:value,
    location:{x:value,y:10,z:20},
  }));
  const zeroPlayer={steamId:'76561198000000199',name:'Measured zero',species:'Triceratops',
    growth:0,health:'0',stamina:'0.25',hunger:0,thirst:0,location:{x:0,y:'10',z:20}};
  for(const p of [...unknownPlayers,zeroPlayer])store.challenges.change(p.steamId,{selected:true,expectedRevision:0,requestKey:`unknown-growth-${p.steamId}`});
  const unknownSample={sampleId:'legacy-feed-unknown',sampledAt:new Date(at+65000).toISOString(),players:[...unknownPlayers,zeroPlayer]};
  assert.equal((await post(unknownSample)).status,201);
  assert.equal((await post(unknownSample)).status,200,'canonical unknown retry remains idempotent');
  const saved=require('../automation-platform/src/services/externalServerSnapshotService').readLatest({nowMs:at+65000});
  for(const p of unknownPlayers){
    const recorded=saved.characters.find(row=>row.steamId===p.steamId);
    for(const field of ['growth','health','stamina','hunger','thirst'])assert.equal(recorded[field],null,`${field} stays unknown for ${p.steamId}`);
    assert.equal(recorded.location,null,'invalid coordinate cannot become an origin observation');
    const life=store.db.prepare('SELECT id,growth FROM vl_lives WHERE steam_id=? AND ended_at IS NULL').get(p.steamId);
    assert.equal(life.growth,null);
    assert.equal(store.db.prepare('SELECT growth FROM dc_observations WHERE steam_id=? AND at=?').get(p.steamId,at+65000).growth,null,'challenge evidence also retains unknown growth');
    assert.equal(store.db.prepare('SELECT 1 FROM vl_growth_milestones WHERE life_id=?').get(life.id),undefined);
  }
  const zero=saved.characters.find(row=>row.steamId===zeroPlayer.steamId);
  assert.equal(zero.growth,0);assert.equal(zero.health,0);assert.equal(zero.stamina,0.25);
  assert.deepEqual(zero.location,{x:0,y:10,z:20});
  assert.equal((await post({sampleId:'legacy-feed-adults',sampledAt:new Date(at+70000).toISOString(),players:[...unknownPlayers,zeroPlayer].map(p=>({...p,growth:1}))})).status,201);
  for(const p of unknownPlayers){
    const life=store.db.prepare('SELECT id FROM vl_lives WHERE steam_id=? AND ended_at IS NULL').get(p.steamId);
    assert.equal(store.db.prepare('SELECT 1 FROM vl_growth_milestones WHERE life_id=?').get(life.id),undefined,'adult alone cannot manufacture juvenile-to-adult evidence');
  }
  const knownLife=store.db.prepare('SELECT id FROM vl_lives WHERE steam_id=? AND ended_at IS NULL').get(zeroPlayer.steamId);
  assert.equal(store.db.prepare('SELECT adult_at FROM vl_growth_milestones WHERE life_id=?').get(knownLife.id).adult_at,at+70000);
});
