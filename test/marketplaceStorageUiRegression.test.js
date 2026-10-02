const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('official marketplace exposes 49% + 75% copy and loads the 49% compatibility renderer', () => {
  const html = read('public/marketplace-official.html');
  const hub = read('public/marketplace.html');
  const fix = read('public/assets/marketplace-49-fix.js');

  assert.match(html, /49% growth or 75% growth/);
  assert.match(hub, /official 49% and 75% Prime growth options/);
  assert.match(html, /marketplace-49-fix\.js/);
  assert.match(fix, /size_percent\) === 49/);
  assert.match(fix, /entry\.size_percent = 50/);
  assert.match(fix, /entry\.size_percent = 49/);
  assert.doesNotThrow(() => new Function(fix));
});

test('stored dinos show an unknown state instead of a fake 0% when a vital is missing', () => {
  const html = read('public/dinostorage/index.html');
  const fix = read('public/assets/mydinos-stat-fix.js');

  assert.match(html, /mydinos-stat-fix\.js/);
  assert.match(fix, /fallback === 0 \? null : fallback/);
  assert.match(fix, /stat-val\">—<\/span>/);
  assert.match(fix, /data-tracked=\"false\"/);
  assert.doesNotThrow(() => new Function(fix));
});

test('marketplace and storage card layout has responsive overflow guards', () => {
  const css = read('public/assets/marketplace-storage-layout-fix.css');

  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /flex-wrap: wrap/);
  assert.match(css, /font-size: clamp\(/);
  assert.match(css, /@media \(max-width: 520px\)/);
});

test('49% catalog items already use normalized 0.49 growth in the shared grant path', () => {
  const catalog = read('automation-platform/src/services/officialMarketplaceCatalogService.js');
  const fulfillment = read('automation-platform/src/services/officialMarketplaceFulfillmentService.js');

  assert.match(catalog, /Official Hollow Valley \$\{speciesName\} at 49% growth/);
  assert.match(catalog, /growth: tier\.growth \/ 100/);
  assert.match(fulfillment, /growth: dino\.growth/);
  assert.match(fulfillment, /bridgeTokens\(order, state\)/);
});
