const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

function mySkinCard(preset) {
  const client = read("public/assets/skins.js");
  const start = client.indexOf("function skinCard(");
  const end = client.indexOf("function wireCardActions(", start);
  assert.ok(start >= 0 && end > start, "Skin Studio exposes its card renderer");
  return vm.runInNewContext(client.slice(start, end) + "\nskinCard(preset, 'mine');", {
    preset,
    me: { user: { steam_id: "76561198000000001", is_admin: false } },
    externalLibraryMeta: value => ({ description: value || "" }),
    escapeHtml: value => String(value ?? ""),
    swatches: () => "",
    colorToHex: () => "#000000",
    skinCardShareMarkup: () => "",
  }, { timeout: 100 });
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
  for (const preset of [
    { id: "created", owner_steam_id: "76561198000000001" },
    { id: "granted", exclusive: true, granted: true },
  ]) assert.match(mySkinCard(preset), /class="small-button skin-edit"/);
  assert.doesNotMatch(mySkinCard({ id: "other", owner_steam_id: "76561198000000002" }), /class="small-button skin-edit"/);
});

test("normal players get Delete for removable My Skins entries", () => {
  for (const preset of [
    { id: "created", owner_steam_id: "76561198000000001" },
    { id: "granted", exclusive: true, granted: true },
  ]) assert.match(mySkinCard(preset), /class="small-button skin-delete"/);
  assert.doesNotMatch(mySkinCard({ id: "other", owner_steam_id: "76561198000000002" }), /class="small-button skin-delete"/);
  assert.match(read("public/assets/skins.js"), /removes only your exclusive copy/);
});

test("managed premium collection cards preserve wear actions without ordinary edit or delete", () => {
  for (const preset of [
    { id: "creator-premium", owner_steam_id: "76561198000000001" },
    { id: "granted-premium", exclusive: true, granted: true },
  ]) {
    const html = mySkinCard({ ...preset, membershipPremium: true, membershipVerifiedSpecies: ["Omniraptor"] });
    assert.doesNotMatch(html, /class="small-button skin-(edit|delete)"/);
    assert.match(html, /class="small-button skin-wear"/);
    assert.match(html, /Premium collection/);
  }
});
