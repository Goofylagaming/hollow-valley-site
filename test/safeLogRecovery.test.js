const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Safe Log recovery captures logout state without destructive park/death actions', () => {
  const lua = read('server-mods/SafeLogRecovery/Scripts/main.lua');

  assert.match(lua, /TIPlayerController:PrepareSafeLogout/);
  assert.match(lua, /BP_SurvivalGameMode_C:K2_OnLogout/);
  assert.match(lua, /pending\/.*steam/);
  assert.match(lua, /completed\/.*steam/);

  assert.doesNotMatch(lua, /SetHealth\s*\(\s*0\s*\)/);
  assert.doesNotMatch(lua, /ActivateDeadbody/);
  assert.doesNotMatch(lua, /DestroyActor/);
  assert.doesNotMatch(lua, /ToggleServerRagdoll/);
});

test('Safe Log recovery is routed through the sole CommandBridge publisher', () => {
  const bridge = read('server-mods/CommandBridge/Scripts/main.lua');
  const service = read('automation-platform/src/services/commandBridgeService.js');
  const recovery = read('automation-platform/src/services/safeLogRecoveryService.js');
  const index = read('automation-platform/src/index.js');

  for (const verb of ['safelog_get', 'safelog_restore', 'safelog_clear']) {
    assert.match(bridge, new RegExp(verb));
    assert.match(service, new RegExp(`${verb}: 'SafeLogRecovery'`));
  }
  assert.match(recovery, /assertPublisherReady/);
  assert.match(index, /\/api\/admin\/safelog-recovery/);
});

test('Safe Log restore is admin-only, explicitly confirmed and visible in Admin Hub', () => {
  const automationRoute = read('automation-platform/src/routes/safeLogRecoveryRoutes.js');
  const websiteRoute = read('server/routes/adminSafeLogRecovery.js');
  const websiteIndex = read('server/index.js');
  const html = read('public/admin.html');
  const js = read('public/assets/admin-safelog.js');

  assert.match(automationRoute, /requireAdminToken/);
  assert.match(automationRoute, /RESTORE SAFELOG/);
  assert.match(automationRoute, /CLEAR SAFELOG/);
  assert.match(websiteRoute, /requireAdmin/);
  assert.match(websiteIndex, /\/api\/admin-safelog-recovery/);
  assert.match(html, /SAFE LOG RECOVERY/);
  assert.match(html, /admin-safelog-form/);
  assert.match(js, /pending \/ unconfirmed safe log/i);
  assert.match(js, /RESTORE SAFELOG/);
  assert.match(js, /CLEAR SAFELOG/);
});
