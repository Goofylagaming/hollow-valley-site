const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('Body Drop page exposes reset controls only through admin UI logic', () => {
  const page = read('public/bodydrop.html');
  const js = read('public/assets/bodydrop.js');
  const index = read('server/index.js');

  assert.match(page, /id="admin-bodydrop-reset-panel"[^>]*hidden/);
  assert.match(page, /Reset BodyDrop cooldown/);
  assert.match(page, /Reset cooldown/);
  assert.match(js, /me\?\.user\?\.is_admin/);
  assert.match(js, /RESET BODYDROP/);
  assert.match(js, /\/api\/admin-bodydrop-reset/);
  assert.match(index, /\/api\/admin-bodydrop-reset/);
});
