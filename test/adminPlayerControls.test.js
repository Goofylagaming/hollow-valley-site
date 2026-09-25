const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(file) {
  return fs.readFileSync(path.join(__dirname, "..", file), "utf8");
}

test("Admin Slay uses a dedicated audited AdminActions path", () => {
  const bridge = read("automation-platform/src/services/commandBridgeService.js");
  const service = read("automation-platform/src/services/adminActionsService.js");
  const adminRoutes = read("automation-platform/src/routes/adminRoutes.js");
  const websiteClient = read("server/services/automationWebsiteClient.js");
  const websiteRoutes = read("server/routes/adminOperations.js");

  assert.match(bridge, /admin_slay:\s*'AdminActions'/);
  assert.match(service, /verb:\s*'admin_slay'/);
  assert.match(service, /ADMIN_ACTION_COMMAND_FAILED/);
  assert.match(service, /ADMIN_ACTION_COMMAND_TIMEOUT/);
  assert.match(adminRoutes, /admin-actions\/slay/);
  assert.match(adminRoutes, /slay_player/);
  assert.match(websiteClient, /function slayAdminPlayer/);
  assert.match(websiteRoutes, /router\.get\("\/players"/);
  assert.match(websiteRoutes, /router\.post\("\/slay"/);
  assert.match(websiteRoutes, /req\.body\?\.confirm[^\n]+SLAY/);
});

test("CommandBridge v006.5 routes admin_slay only to AdminActions", () => {
  const lua = read("server-mods/CommandBridge/Scripts/main.lua");
  assert.match(lua, /CommandBridge v006\.5/);
  assert.match(lua, /MOD_VERSION = "v006\.5"/);
  assert.match(lua, /AdminActions\/Saved\/inbox\.ndjson/);
  assert.match(lua, /verb == "admin_slay"/);
  assert.match(lua, /writeToAdminActionsInbox\(id, steam, \{"slay"\}\)/);
});

test("AdminActions v004 keeps Slay stable and inspects native Smite signatures", () => {
  const lua = read("server-mods/AdminActions/Scripts/main.lua");
  assert.match(lua, /AdminActions v004/);
  assert.match(lua, /MOD_VERSION = "v004"/);
  assert.match(lua, /GetControllerBySteamId\(steam\)/);
  assert.match(lua, /K2_GetPawn\(\)/);
  assert.match(lua, /SetHealth\(0\)/);
  assert.match(lua, /ForceNetUpdate\(\)/);
  assert.match(lua, /lightning-probe\.flag/);
  assert.match(lua, /ForEachUObject/);
  assert.match(lua, /GetFName\(\)/);
  assert.match(lua, /ForEachFunction/);
  assert.match(lua, /lightning.*thunder.*storm.*weather.*strike.*smite/s);
  assert.match(lua, /LightningProbe DONE/);
  assert.match(lua, /LightningProbe PARAM/);
  assert.match(lua, /ServerSmite/);
  assert.match(lua, /SetSmited/);
  assert.match(lua, /ForEachProperty/);
  assert.match(lua, /"source":"AdminActions"/);

  assert.doesNotMatch(lua, /BP_SmiteEffect/);
  assert.doesNotMatch(lua, /CustomEvent\(\)/);
  assert.doesNotMatch(lua, /K2_DestroyActor\(/);
  assert.doesNotMatch(lua, /SpawnLightning|TriggerLightning|LightningStrike/);
});

test("Admin Hub renders connected player controls and requires browser confirmation", () => {
  const html = read("public/admin.html");
  const js = read("public/assets/admin.js");

  assert.match(html, /LIVE PLAYER CONTROLS/);
  assert.match(html, /id="admin-player-list"/);
  assert.match(js, /button\.textContent = "Slay"/);
  assert.match(js, /\/api\/admin-operations\/players/);
  assert.match(js, /\/api\/admin-operations\/slay/);
  assert.match(js, /confirm\(\`Slay/);
  assert.match(js, /confirm:\s*"SLAY"/);
});
