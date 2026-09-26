const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('legacy website game execution is permanently retired while modern routes remain mounted', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');

  assert.doesNotMatch(source, /LEGACY_DIRECT_GAME_API_ENABLED/);
  assert.doesNotMatch(source, /dinoStorageRouter/);
  assert.doesNotMatch(source, /commandBridgeInternalRouter/);
  assert.doesNotMatch(source, /herbyBot\.start/);
  assert.match(source, /LEGACY_DIRECT_GAME_API_RETIRED/);
  assert.match(source, /app\.use\("\/api\/internal\/commandbridge", legacyDirectGameApiRetired\)/);
  assert.match(source, /app\.use\("\/api\/dinostorage", legacyDirectGameApiRetired\)/);
  assert.match(source, /app\.use\("\/api\/mydinos", mydinosRouter\)/);
  assert.match(source, /app\.use\("\/api\/bodydrop", bodydropRouter\)/);
  assert.match(source, /app\.use\("\/api\/admin-operations", adminOperationsRouter\)/);

  const retiredFiles = [
    'api/admin.js',
    'api/park.js',
    'api/parked.js',
    'api/playerdata.js',
    'api/rcon.js',
    'api/redeem.js',
    'server/herbyBot.js',
    'server/rcon.js',
    'server/routes/commandBridgeInternal.js',
    'server/routes/dinoStorage.js',
    'server/services/bodyDrop.js',
    'server/services/commandBridge.js',
    'server/services/commandBridgeHttp.js',
    'server/services/dinoStorage.js',
    'server/services/sftpBridge.js',
  ];

  for (const relativePath of retiredFiles) {
    assert.equal(fs.existsSync(path.join(__dirname, '..', relativePath)), false, `${relativePath} should stay retired`);
  }
});

test('My Dinos keeps only transport-free DinoStorage validation', () => {
  const helper = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'dinoStorageFiles.js'), 'utf8');
  assert.match(helper, /dinoStorageValidation/);
  assert.doesNotMatch(helper, /basic-ftp|sftpBridge|commandBridge/);
});

test('website BodyDrop has no generic size-based fallback catalogue', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'bodydrop.js'), 'utf8');
  assert.doesNotMatch(source, /BODYDROP_TYPES/);
  assert.doesNotMatch(source, /Small body|Medium body|Large body/);
  assert.match(source, /options: Array\.isArray\(result\.options\) \? result\.options : \[\]/);
});
