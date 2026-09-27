const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('Prime tracker uses last-known storage evidence instead of issuing dino_list reads', () => {
  const source = read('server/routes/mydinos.js');
  const start = source.indexOf('router.get("/prime-tracker"');
  const end = source.indexOf('router.get("/requests/:id"', start);
  assert.ok(start >= 0 && end > start);
  const primeRoute = source.slice(start, end);
  assert.match(primeRoute, /rememberedStorageSnapshot/);
  assert.doesNotMatch(primeRoute, /automation\.listStoredDinos/);
});

test('DinoStorage list reads are coalesced, cached and given a wider bridge window', () => {
  const source = read('automation-platform/src/services/dinoStorageService.js');
  assert.match(source, /const listInflight = new Map\(\)/);
  assert.match(source, /const listCache = new Map\(\)/);
  assert.match(source, /DINOSTORAGE_LIST_CACHE_MS/);
  assert.match(source, /DINOSTORAGE_LIST_TIMEOUT_MS/);
  assert.match(source, /12000/);
  assert.match(source, /if \(existing\) return existing/);
  assert.match(source, /invalidateStoredDinoCache/);
});
