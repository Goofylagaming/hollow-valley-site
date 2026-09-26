const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('website BodyDrop routes use the species diet service exclusively', () => {
  const routePath = path.join(__dirname, '..', 'src', 'routes', 'websiteRoutes.js');
  const source = fs.readFileSync(routePath, 'utf8');

  assert.match(source, /const speciesBodyDrop = require\('\.\.\/services\/speciesBodyDropService'\);/);
  assert.doesNotMatch(source, /const bodyDrop = require\('\.\.\/services\/bodyDropService'\);/);
  assert.match(source, /speciesBodyDrop\.getBodyDropState\(steamId\)/);
  assert.match(source, /speciesBodyDrop\.requestBodyDrop\(/);
  assert.match(source, /BODYDROP_DIET_MISMATCH/);
});
