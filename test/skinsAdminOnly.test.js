const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("Skin Studio player routes are no longer globally admin-only", () => {
  const route = read("server/routes/skins.js");
  assert.doesNotMatch(route, /router\.use\(requireAdmin\)/);
  assert.match(route, /router\.post\("\/studio", requireAuth/);
  assert.match(route, /router\.post\("\/:id\/wear", requireAuth/);
  assert.match(route, /router\.post\("\/:id\/apply", requireAuth/);
});

test("Skin Studio page is accessible without an admin gate", () => {
  const server = read("server/index.js");
  assert.match(server, /app\.get\(\["\/skins", "\/skins\.html"\]/);
  assert.doesNotMatch(server, /Admin access required/);
});

test("Skin Studio navigation is visible to everyone", () => {
  const nav = read("public/partials/nav.html");
  const common = read("public/assets/common.js");
  assert.match(nav, /href="\/skins" id="skin-studio-nav"/);
  assert.doesNotMatch(nav, /id="skin-studio-nav" hidden/);
  assert.doesNotMatch(common, /skinStudioNav\.hidden = !isAdmin/);
});

test("Admin-only skin management remains protected", () => {
  const route = read("server/routes/skins.js");
  assert.match(route, /router\.post\("\/external\/batch-preview", requireAdmin/);
  assert.match(route, /router\.post\("\/:id\/grant", requireAdmin/);
  assert.match(route, /router\.post\("\/:id\/revoke", requireAdmin/);
  assert.match(route, /router\.get\("\/:id\/grants", requireAdmin/);
  assert.match(route, /router\.post\("\/:id\/publish", requireAdmin/);
});


test("normal players can edit their created or granted exclusive skins in My Skins", () => {
  const client = read("public/assets/skins.js");
  assert.match(client, /const canEdit = isCreator \|\| Boolean\(preset\.exclusive && preset\.granted\)/);
  assert.match(client, /if \(mode === "mine" && canEdit\)/);
  assert.match(client, /class="small-button skin-edit"/);
});

test("normal players get Delete for removable My Skins entries", () => {
  const client = read("public/assets/skins.js");
  assert.match(client, /const canDelete = isCreator \|\| Boolean\(preset\.exclusive && preset\.granted\)/);
  assert.match(client, /if \(mode === "mine" && canDelete\)/);
  assert.match(client, /class="small-button skin-delete"/);
  assert.match(client, /removes only your exclusive copy/);
});
