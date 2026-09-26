const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('website server status is automation-only', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'serverStatus.js'), 'utf8');

  assert.match(source, /automation\.getServerSnapshot\(\)/);
  assert.doesNotMatch(source, /require\("\.\.\/rcon"\)/);
  assert.doesNotMatch(source, /RCON_PASSWORD|RCON_HOST|RCON_PORT/);
  assert.doesNotMatch(source, /recordLivePlaytime/);
  assert.doesNotMatch(source, /directRconConfigured/);
  assert.match(source, /source: "automation-cache"/);
});
