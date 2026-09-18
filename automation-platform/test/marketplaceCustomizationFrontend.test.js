const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relative) {
  return fs.readFileSync(path.join(__dirname, '..', '..', relative), 'utf8');
}

test('marketplace, My Dinos and skins browser scripts parse successfully', () => {
  for (const relative of [
    'public/assets/mydinos.js',
    'public/assets/marketplace.js',
    'public/assets/skins.js',
  ]) {
    const source = read(relative);
    assert.doesNotThrow(() => new Function(source), relative);
  }
});

test('My Dinos exposes sell, mutation and skin tools for parked dinos', () => {
  const source = read('public/assets/mydinos.js');
  assert.match(source, /data-tool="sell"/);
  assert.match(source, /data-tool="mutations"/);
  assert.match(source, /data-tool="skins"/);
  assert.match(source, /\/api\/mydinos\/stored\/\$\{encodeURIComponent\(dino\.slot\)\}\/mutations/);
  assert.match(source, /\/api\/skins\/from-stored/);
  assert.match(source, /\/api\/marketplace\/listings/);
});

test('marketplace UI includes public escrow listings and seller cancellation panel', () => {
  const js = read('public/assets/marketplace.js');
  const html = read('public/marketplace.html');
  assert.match(js, /loadMyListings/);
  assert.match(js, /\/api\/marketplace\/listings\/mine/);
  assert.match(js, /cancel-listing-btn/);
  assert.match(html, /id="my-listings-section"/);
  assert.match(html, /YOUR LISTINGS/);
});

test('skins page no longer offers the legacy name-only creator', () => {
  const html = read('public/skins.html');
  const js = read('public/assets/skins.js');
  assert.equal(html.includes('id="skin-create-btn"'), false);
  assert.equal(js.includes('skin-create-btn'), false);
  assert.match(js, /\/api\/skins\/mine/);
  assert.match(html, /Captured from DinoStorage/);
});

test('branch routes use automation adapters for real parked-dino features', () => {
  const myDinos = read('server/routes/mydinos.js');
  const marketplace = read('server/routes/marketplace.js');
  const skins = read('server/routes/skins.js');

  assert.match(myDinos, /automationRoutes\.getParkedDinoMutations/);
  assert.match(myDinos, /automationRoutes\.updateParkedDinoMutations/);
  assert.match(marketplace, /automationRoutes\.createDinoMarketplaceListing/);
  assert.match(marketplace, /automationRoutes\.buyDinoMarketplaceListing/);
  assert.match(marketplace, /automationRoutes\.cancelDinoMarketplaceListing/);
  assert.match(skins, /automationRoutes\.listSkinPresets/);
  assert.match(skins, /automationRoutes\.createSkinPreset/);
  assert.match(skins, /automationRoutes\.applySkinPreset/);
});


test('My Dinos tool wiring contains no accidental literal escaped newline between statements', () => {
  const source = read('public/assets/mydinos.js');
  assert.equal(source.includes('wireParkedTools(grid);\\n'), false);
  assert.match(source, /wireParkedTools\(grid\);\s+grid\.querySelectorAll/);
});
