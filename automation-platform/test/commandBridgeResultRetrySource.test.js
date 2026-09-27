const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', '..', 'server-mods', 'CommandBridge', 'Scripts', 'main.lua'),
  'utf8'
);

test('CommandBridge retries failed result POSTs and deduplicates by result line', () => {
  assert.match(source, /CommandBridge v006\.6/);
  assert.match(source, /local forwardingResults = \{\}/);
  assert.match(source, /local key = tostring\(line or ""\)/);
  assert.match(source, /forwardingResults\[key\] = true/);
  assert.match(source, /forwardingResults\[key\] = nil/);
  assert.match(source, /forwardedResults\[key\] = true/);
  assert.match(source, /will retry/);
  assert.doesNotMatch(source, /forwardedResults\[id\] = true/);
  assert.match(source, /not forwardedResults\[line\] and not forwardingResults\[line\]/);
});
