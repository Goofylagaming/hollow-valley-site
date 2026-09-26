const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('legacy direct game APIs are environment-gated while modern routes remain mounted', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');

  assert.match(source, /LEGACY_DIRECT_GAME_API_ENABLED/);
  assert.match(source, /if \(LEGACY_DIRECT_GAME_API_ENABLED\)/);
  assert.match(source, /app\.use\("\/api\/dinostorage", dinoStorageRouter\)/);
  assert.match(source, /LEGACY_DIRECT_GAME_API_DISABLED/);
  assert.match(source, /app\.use\("\/api\/mydinos", mydinosRouter\)/);
  assert.match(source, /app\.use\("\/api\/bodydrop", bodydropRouter\)/);
  assert.match(source, /app\.use\("\/api\/admin-operations", adminOperationsRouter\)/);
});
