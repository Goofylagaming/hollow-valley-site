const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("Skin Studio API is admin-only while testing", () => {
  const route = read("server/routes/skins.js");
  assert.match(route, /router\.use\(requireAdmin\)/);
});

test("Skin Studio page cannot be reached through public page or static html routes", () => {
  const server = read("server/index.js");
  assert.doesNotMatch(server, /PAGE_ROUTES[^\n]*"skins"/);
  assert.match(server, /app\.get\(\["\/skins", "\/skins\.html"\]/);
  assert.match(server, /if \(!req\.user\.is_admin\) return res\.status\(403\)/);
});

test("Skin Studio navigation is hidden by default and only revealed for admins", () => {
  const nav = read("public/partials/nav.html");
  const common = read("public/assets/common.js");
  assert.match(nav, /id="skin-studio-nav" hidden/);
  assert.match(common, /const skinStudioNav = document\.getElementById\("skin-studio-nav"\)/);
  assert.match(common, /skinStudioNav\.hidden = !isAdmin/);
});
