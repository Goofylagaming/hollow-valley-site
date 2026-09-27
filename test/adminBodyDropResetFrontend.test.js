const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('Admin Hub exposes guarded BodyDrop reset tool', () => {
  const hub = read('public/admin.html');
  const page = read('public/adminbodydrop.html');
  const js = read('public/assets/adminbodydrop.js');
  const index = read('server/index.js');

  assert.match(hub, /href="\/adminbodydrop"/);
  assert.match(hub, /Reset cooldown/);
  assert.match(page, /BODYDROP COOLDOWN EXCEPTION/);
  assert.match(page, /17-digit Steam ID/);
  assert.match(js, /RESET BODYDROP/);
  assert.match(js, /\/api\/admin-bodydrop-reset/);
  assert.match(index, /adminbodydrop:\s*"adminbodydrop\.html"/);
  assert.match(index, /\/api\/admin-bodydrop-reset/);
});
