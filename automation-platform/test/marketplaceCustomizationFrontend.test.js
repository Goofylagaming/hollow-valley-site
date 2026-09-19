const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relative) {
  return fs.readFileSync(path.join(__dirname, '..', '..', relative), 'utf8');
}

test('marketplace, My Dinos and skins browser scripts parse successfully', () => {
  for (const relative of ['public/assets/mydinos.js','public/assets/marketplace.js','public/assets/skins.js']) {
    assert.doesNotThrow(() => new Function(read(relative)), relative);
  }
});

test('My Dinos exposes sell, mutation and skin tools for parked dinos', () => {
  const source = read('public/assets/mydinos.js');
  assert.match(source, /stored-sell/);
  assert.match(source, /data-tool="mutations"/);
  assert.match(source, /data-tool="skins"/);
  assert.match(source, /\/api\/mydinos\/stored\//);
  assert.match(source, /\/api\/skins\/from-stored/);
  assert.match(source, /\/api\/marketplace\/listings/);
});

test('marketplace UI exposes order history, seller listings and captured skin previews', () => {
  const js = read('public/assets/marketplace.js');
  const html = read('public/marketplace.html');
  assert.match(js, /loadMyOrders/);
  assert.match(js, /loadMyListings/);
  assert.match(js, /listingSkinPreview/);
  assert.match(js, /\/api\/marketplace\/orders\/mine/);
  assert.match(js, /\/api\/marketplace\/listings\/mine/);
  assert.match(html, /YOUR STORE ORDERS/);
  assert.match(html, /YOUR LISTINGS/);
});

test('marketplace and parked-dino routes use guarded automation-backed writes', () => {
  const myDinos = read('server/routes/mydinos.js');
  const marketplace = read('server/routes/marketplace.js');
  const skins = read('server/routes/skins.js');
  assert.match(myDinos, /automation\.getParkedDinoMutations/);
  assert.match(myDinos, /automation\.updateParkedDinoMutations/);
  assert.match(marketplace, /automation\.createDinoMarketplaceListing/);
  assert.match(marketplace, /automation\.buyDinoMarketplaceListing/);
  assert.match(marketplace, /automation\.cancelDinoMarketplaceListing/);
  assert.match(skins, /automation\.listSkinPresets/);
  assert.match(skins, /automation\.createSkinPresetFromStored/);
  assert.match(skins, /automation\.applySkinPreset/);
});

test('marketplace write-state gates remain visible in the UI', () => {
  const marketplace = read('public/assets/marketplace.js');
  const myDinos = read('public/assets/mydinos.js');
  assert.match(marketplace, /officialWritesEnabled/);
  assert.match(marketplace, /p2pWritesEnabled/);
  assert.match(myDinos, /p2pWritesEnabled/);
});
