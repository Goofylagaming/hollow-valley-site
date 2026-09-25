const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const lua = fs.readFileSync(
  path.join(__dirname, "..", "server-mods", "EliteFishSpawner", "Scripts", "main.lua"),
  "utf8"
);

test("EliteFishSpawner doubles only elite fish natural spawns", () => {
  assert.match(lua, /EliteFishSpawner v001/);
  assert.match(lua, /spawnMultiplier = 2/);
  assert.match(lua, /BP_Elite_Fish_CatFish\.BP_Elite_Fish_CatFish_C/);
  assert.match(lua, /BP_Elite_Fish_Coelacanth\.BP_Elite_Fish_Coelacanth_C/);

  assert.equal(lua.includes("BP_Fish_Catfish.BP_Fish_Catfish_C"), false);
  assert.equal(lua.includes("BP_Fish_Hoplosternum"), false);
  assert.equal(lua.includes("BP_Fish_Longear"), false);
  assert.equal(lua.includes("BP_Fish_MuskelLunge"), false);
  assert.equal(lua.includes("BP_Fish_RainbowFish"), false);
});

test("EliteFishSpawner learns water anchors event-first and avoids recursive spawning", () => {
  assert.match(lua, /\/Script\/Engine\.Actor:ReceiveBeginPlay/);
  assert.match(lua, /\/Script\/Engine\.Actor:ReceiveEndPlay/);
  assert.match(lua, /rememberAnchor/);
  assert.match(lua, /supplementalSpawnInProgress/);
  assert.match(lua, /supplementalAddress/);
  assert.match(lua, /if supplemental then/);
  const supplementalBranch = lua.indexOf("if supplemental then");
  const naturalLog = lua.indexOf('"Natural %s BeginPlay', supplementalBranch);
  const schedule = lua.indexOf("scheduleBonus(kind)", naturalLog);
  assert.ok(supplementalBranch >= 0 && naturalLog > supplementalBranch && schedule > naturalLog);
  assert.equal(/\n\s*FindAllOf\s*\(/.test(lua), false);
});

test("EliteFishSpawner has explicit load caps and does not destroy actors", () => {
  assert.match(lua, /maxActivePerSpecies = 24/);
  assert.match(lua, /maxActiveTotal = 40/);
  assert.match(lua, /species-cap/);
  assert.match(lua, /total-cap/);
  assert.equal(lua.includes("K2_DestroyActor"), false);
  assert.equal(lua.includes("DestroyActor"), false);
});

test("EliteFishSpawner spawns only at learned coordinates and enables normal replication", () => {
  assert.match(lua, /chooseAnchor/);
  assert.match(lua, /world:SpawnActor/);
  assert.match(lua, /pawn:SpawnDefaultController\(\)/);
  assert.match(lua, /pawn:SetReplicates\(true\)/);
  assert.match(lua, /pawn:ForceNetUpdate\(\)/);
});
