const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

test('PrimePersistence restores completed flags conservatively', () => {
  const lua = read('server-mods/PrimePersistence/Scripts/main.lua');

  assert.match(lua, /GetEligiblePrimeElderData/);
  assert.match(lua, /SetEligiblePrimeElderData/);
  assert.match(lua, /bPrimeCondition/);
  assert.match(lua, /saved\.eligible == true/);
  assert.match(lua, /RESTORE_GROWTH_TOLERANCE/);
  assert.match(lua, /saved\.classPath ~= current\.classPath/);
  assert.match(lua, /restoredThisBoot/);
  assert.match(lua, /saved\.savedAt < BOOT_STARTED_AT/);

  // Never bulk-enumerate stale UE objects; production uses the Steam registry
  // and resolves fresh controllers by SteamID every tick.
  assert.doesNotMatch(lua, /FindAllOf\(/);
  assert.match(lua, /GetControllerBySteamId/);
});

test('Prime fix installer updates live mods with backups', () => {
  const ps1 = read('scripts/windows/Install-HollowValley-PrimeFix.ps1');
  assert.match(ps1, /DinoStorage\\Scripts\\main\.lua/);
  assert.match(ps1, /CommandBridge\\Scripts\\main\.lua/);
  assert.match(ps1, /PrimePersistence\\Scripts\\main\.lua/);
  assert.match(ps1, /\.bak-\$stamp/);
  assert.match(ps1, /PrimePersistence : 1/);
  assert.match(ps1, /GAME SERVER RESTART/);
});
