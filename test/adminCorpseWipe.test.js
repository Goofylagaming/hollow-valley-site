const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("Admin Operations exposes the guarded corpse wipe control", () => {
  const html = read("public/adminoperations.html");
  const client = read("public/assets/adminoperations.js");
  const route = read("server/routes/adminOperations.js");

  assert.match(html, /id="ops-corpse-wipe"/);
  assert.match(html, /CORPSE WIPE/);
  assert.match(client, /actionGates\?\.wipeCorpses/);
  assert.match(client, /WIPE CORPSES/);
  assert.match(client, /\/api\/admin-operations\/corpse-wipe/);
  assert.match(route, /router\.post\("\/corpse-wipe"/);
  assert.match(route, /WIPE CORPSES/);
});
