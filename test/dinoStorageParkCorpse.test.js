const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "server-mods", "DinoStorage", "Scripts", "main.lua"),
  "utf8"
);

test("DinoStorage v008 parks into a full replicated corpse", () => {
  assert.match(source, /DinoStorage v008/);
  assert.match(source, /MOD_VERSION = "v008"/);
  assert.match(source, /transitionParkedPawnToCorpse/);
  assert.match(source, /SetGrowth\(growth or 1\.0\)/);
  assert.match(source, /SetHealth\(0\)/);
  assert.match(source, /bIsDead = true/);
  assert.match(source, /OnRep_IsNowDead\(\)/);
  assert.match(source, /ToggleServerRagdoll\(true\)/);
  assert.match(source, /ActivateDeadbody\(false, STORE_CORPSE_LIFETIME_SEC\)/);
  assert.match(source, /ForceNetUpdate\(\)/);
});

test("parked corpse is no longer hidden or destroyed after 1.5 seconds", () => {
  assert.equal(source.includes("STORE_CORPSE_CLEANUP_MS"), false);

  const storeStart = source.indexOf("local function cmdStore");
  const retrieveStart = source.indexOf("local function cmdRetrieve", storeStart);
  assert.ok(storeStart >= 0 && retrieveStart > storeStart);

  const storeBody = source.slice(storeStart, retrieveStart);
  assert.equal(storeBody.includes("SetActorHiddenInGame"), false);
  assert.equal(storeBody.includes("SetActorEnableCollision(false)"), false);
  assert.equal(storeBody.includes("K2_DestroyActor"), false);
  assert.equal(storeBody.includes("DestroyActor"), false);
});

test("park corpse transition is observable in UE4SS logs", () => {
  assert.match(source, /Park corpse transition OK/);
  assert.match(source, /Park corpse transition PARTIAL/);
});
