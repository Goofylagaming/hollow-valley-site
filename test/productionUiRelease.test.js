const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const productionSha = "86499c14d1e587714dcd2e4ab9ec91a85284aa15";
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const previous = (rel) => execFileSync("git", ["show", productionSha + ":" + rel], { cwd: root, encoding: "utf8" });

const keyPages = [
  "wallet.html", "profile.html", "quests.html", "events.html", "leaderboard.html",
  "livemap.html", "skins.html", "supporter.html", "friends.html", "bodydrop.html",
  "mydinos.html", "mydinos/index.html", "mydinos/admin.html", "mydinos/parked.html",
  "dinostorage/index.html", "marketplace.html", "marketplace-official.html",
  "marketplace-players.html", "admin.html", "adminoperations.html",
  "admincomms.html", "adminrestore.html", "adminsupporters.html", "owner-login.html",
];
const railPages = new Set([
  "profile.html", "wallet.html", "skins.html", "friends.html", "bodydrop.html",
  "mydinos.html", "mydinos/index.html", "mydinos/admin.html", "mydinos/parked.html",
  "dinostorage/index.html", "marketplace.html", "marketplace-official.html",
  "marketplace-players.html",
]);
function scriptSources(html) {
  return Array.from(html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi), (m) =>
    m[1].replace(/\?v=\d+$/, "").replace(/^\//, "")
  ).filter((src) => !src.endsWith("assets/common.js"));
}
test("production backend retains existing routes while Territory Wars stays isolated and off by default", () => {
  const index = read("server/index.js");
  for (const route of ["/api/wallet", "/api/marketplace", "/api/groups",
    "/api/skins", "/api/quests", "/api/bodydrop", "/api/admin-operations"]) {
    assert.ok(index.includes(route), "Missing existing route " + route);
  }
  assert.ok(index.includes('TERRITORY_WARS_ADMIN_TEST_ENABLED = process.env.TERRITORY_WARS_ADMIN_TEST_ENABLED === "1"'));
  assert.ok(index.includes('requireTerritoryAdmin'));
  assert.ok(!index.includes('routes/territoryWarsInternal'));
  assert.ok(read("server/middleware/requireTerritoryAdmin.js").includes('ALLOWED_STEAM_IDS'));
  assert.ok(read("server/routes/territoryWars.js").includes('router.tickRuntime'));

});
test("all production wallet, marketplace, storage, admin and other page scripts survive", () => {
  for (const page of keyPages) {
    const file = "public/" + page;
    assert.deepEqual(
      scriptSources(read(file)),
      scriptSources(previous(file)),
      page + ": feature scripts were dropped or reordered"
    );
  }
});
test("every public page preloads the upgraded UI without losing its base CSS", () => {
  for (const page of ["index.html", ...keyPages]) {
    const html = read("public/" + page);
    const base = html.search(/styles\.css\?v=\d+/);
    const modern = html.indexOf("/assets/ui-v2.css?v=3");
    const theme = html.indexOf("/assets/snapshot-ui.css?v=4");
    assert.ok(base >= 0 && modern > base && theme > modern, page);
    if (page === "index.html" || railPages.has(page)) {
      assert.match(html, /<body class="has-my-stuff-rail">/, page);
    }
  }
});
test("v2 homepage retains production's species dialog and existing script", () => {
  const html = read("public/index.html");
  assert.match(html, /class="[^"]*snapshot-home/);
  assert.match(html, /id="species"/);
  assert.match(html, /class="dino-dialog"/);
  assert.match(html, /assets\/site\.js\?v=8/);
  assert.match(html, /assets\/home-v2\.js\?v=2/);
  assert.ok(fs.statSync(path.join(root, "public/assets/images/hollow-valley-banner.png")).size > 10000);
});
test("shared navigation retains production owner login and admin permission hiding", () => {
  const common = read("public/assets/common.js");
  const nav = read("public/partials/nav.html");
  assert.match(common, /function normalizePublicBranding\(\)/);
  assert.match(common, /href="\/owner-login"/);
  assert.match(common, /adminNavLink\.hidden = !isAdmin/);
  assert.match(nav, /id="admin-nav-group" hidden/);
  assert.match(nav, /class="menu-toggle"/);
  assert.match(nav, /id="territory-admin-nav-link" hidden/);
  assert.match(common, /territoryWarsAdminAccess/);
});
test("CSS preserves semantic red for errors and green for success", () => {
  const theme = read("public/assets/snapshot-ui.css");
  assert.match(theme, /--snap-red:\s*#ef5c65/);
  assert.match(theme, /--snap-green:\s*#30e69a/);
});
