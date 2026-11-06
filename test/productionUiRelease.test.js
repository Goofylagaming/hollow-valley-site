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
    // Approved test-preview Live Map migration intentionally extends this page.
    if (page === "livemap.html") continue;
    const file = "public/" + page;
    const actual = scriptSources(read(file));
    const baseline = scriptSources(previous(file));
    if (page === "profile.html" || page === "supporter.html") {
      // Membership presentation extends both pages before their existing page
      // controllers; all production feature scripts retain their exact order.
      const membership = "assets/membership-rewards.js";
      const subscriberBar = "assets/subscriber-progress.js";
      const controller = page === "profile.html" ? "assets/profile.js" : "assets/supporter.js";
      assert.equal(actual.filter(src => src === membership).length, 1,
        page + ": membership rewards helper must load exactly once");
      assert.equal(actual.indexOf(membership), actual.indexOf(controller) - 1,
        page + ": membership rewards helper must immediately precede the page controller");
      if (page === "supporter.html") {
        assert.equal(actual.filter(src => src === subscriberBar).length, 1,
          "Public Subscriber Bar helper must load exactly once");
        assert.equal(actual.indexOf(subscriberBar), actual.indexOf("assets/supporter-stripe-upgrade.js") + 1,
          "Subscriber Bar helper must follow the existing membership controls");
      }
      assert.deepEqual(actual.filter(src => src !== membership && (page !== "supporter.html" || src !== subscriberBar)), baseline,
        page + ": existing feature scripts must be preserved");
    } else if (page === "quests.html") {
      const dynamic="assets/dynamic-challenges.js",season="assets/season-track.js";
      assert.equal(actual.filter(src=>src===dynamic).length,1,"Dynamic challenge controls must load once");
      assert.equal(actual.indexOf(dynamic),actual.indexOf("assets/quests.js")+1,"Dynamic challenges follow the original quest controller");
      assert.equal(actual.filter(src=>src===season).length,1,"Season controls must load once");
      assert.equal(actual.indexOf(season),actual.indexOf(dynamic)+1,"Season controls follow existing quest modules");
      assert.deepEqual(actual.filter(src=>src!==dynamic&&src!==season),baseline,"Original quest scripts retain their order");
    } else if (page === "skins.html") {
      // v015 intentionally inserts the auto-map and batch-mask helpers before
      // the original viewer. The entire pre-existing script order is preserved.
      const autoMap = "assets/skin-studio-auto-map.js";
      const batchMap = "assets/skin-studio-batch-map.js";
      const extractedRegistry = "assets/skin-studio-extracted-registry.js";
      const reader = "assets/skin-studio-3d.js";
      const premium = "assets/premium-skins.js";
      assert.equal(actual.filter(src => src === premium).length, 1,
        "Premium skin controls must load exactly once");
      assert.equal(actual.indexOf(premium), actual.indexOf("assets/skins.js") + 1,
        "Premium skin controls must immediately follow the existing Skin Studio controller");
      assert.equal(actual.indexOf(autoMap), actual.indexOf(batchMap) - 1, "Batch helper follows auto-map");
      assert.equal(actual.indexOf(batchMap), actual.indexOf(reader) - 1, "Batch helper precedes the viewer");
      assert.equal(actual.filter(src => src === autoMap).length, 1);
      assert.equal(actual.filter(src => src === batchMap).length, 1);
      // Current production Skin Studio also loads the extracted model registry
      // immediately after the legacy model registry. The pinned baseline predates
      // that additive script, so preserve it explicitly instead of misclassifying
      // it as a dropped/reordered feature.
      assert.equal(actual.filter(src => src === extractedRegistry).length, 1,
        "Extracted Skin Studio registry must load exactly once");
      assert.equal(actual.indexOf(extractedRegistry), actual.indexOf("assets/skin-studio-model-registry.js") + 1,
        "Extracted registry must follow the existing model registry");
      assert.deepEqual(actual.filter(src => src !== autoMap && src !== batchMap && src !== premium && src !== extractedRegistry), baseline,
        page + ": existing feature scripts must be preserved");
    } else if (page === "dinostorage/index.html") {
      // Prime zone reset is the only additive DinoStorage script. Existing
      // storage/marketplace scripts must retain their exact order.
      const reset = "assets/prime-zone-reset.js";
      assert.equal(actual.filter(src => src === reset).length, 1,
        "Prime reset script appears once");
      assert.equal(actual.indexOf(reset), actual.indexOf("assets/mydinos.js") + 1,
        "Reset handler must load after the existing Prime tracker");
      assert.deepEqual(actual.filter(src => src !== reset), baseline,
        "DinoStorage's existing production scripts must remain in order");
    } else if (page === "adminoperations.html") {
      const speciesAdmin = "assets/species-events-admin.js";
      const growthProbe = "assets/omniraptor-growth-validation.js";
      const achievementReview = "assets/achievement-review.js";
      assert.equal(actual.filter(src => src === achievementReview).length, 1,
        "Achievement review controls must load exactly once");
      assert.ok(actual.indexOf(achievementReview) > actual.indexOf("assets/adminoperations.js"),
        "Achievement review loads after the existing operations controls");
      assert.equal(actual.filter(src => src === speciesAdmin).length, 1,
        "Timed species event admin script must load exactly once");
      assert.equal(actual.filter(src => src === growthProbe).length, 1,
        "Omniraptor read-only validation script must load exactly once");
      assert.ok(actual.indexOf(speciesAdmin) > actual.indexOf("assets/adminoperations.js"),
        "Species event controls load after the existing operations controls");
      assert.ok(actual.indexOf(growthProbe) > actual.indexOf(speciesAdmin),
        "Read-only Omniraptor validation loads after the existing species event controls");
      assert.deepEqual(actual.filter(src => src !== speciesAdmin && src !== growthProbe && src !== achievementReview), baseline,
        "Existing Admin Operations scripts must retain their original order");
    } else if (page === "events.html") {
      const randomEvents = "assets/events-species-bonuses.js";
      const groupRoster = "assets/events-group-roster.js";
      const attendanceEvidence="assets/challenge-attendance-admin.js";
      const templates="assets/event-templates.js";
      const schedules="assets/event-schedules.js";
      const registrations="assets/event-registrations.js";
      const teams="assets/event-teams.js";
      const results="assets/event-results.js";
      assert.equal(actual.filter(src => src === randomEvents).length, 1,
        "Random event display script must be loaded exactly once");
      assert.ok(actual.indexOf(randomEvents) > actual.indexOf("assets/events.js"),
        "Public event bonuses load after the existing Events script");
      assert.equal(actual.filter(src => src === groupRoster).length, 1,
        "Staff group event roster must load exactly once");
      assert.ok(actual.indexOf(groupRoster) > actual.indexOf("assets/events-admin-delete.js"),
        "Staff group roster loads after the existing Events controls");
      assert.equal(actual.filter(src=>src===attendanceEvidence).length,1,"Staff attendance evidence controls must load exactly once");
      assert.equal(actual.indexOf(attendanceEvidence),actual.indexOf(groupRoster)+1,"Attendance evidence controls follow the existing roster");
      assert.equal(actual.filter(src=>src===templates).length,1,"Event template controls must load exactly once");
      assert.equal(actual.indexOf(templates),actual.indexOf(attendanceEvidence)+1,"Event templates follow existing attendance controls");
      assert.equal(actual.filter(src=>src===schedules).length,1,"Website schedule controls must load exactly once");
      assert.equal(actual.indexOf(schedules),actual.indexOf(templates)+1,"Website schedules follow the template controls");
      assert.equal(actual.filter(src=>src===registrations).length,1,"Private registration controls must load exactly once");
      assert.equal(actual.indexOf(registrations),actual.indexOf(schedules)+1,"Registration follows the public schedule controls");
      assert.equal(actual.filter(src=>src===teams).length,1,"Staff team controls must load exactly once");
      assert.equal(actual.indexOf(teams),actual.indexOf(registrations)+1,"Staff teams follow the private registration controls");
      assert.equal(actual.filter(src=>src===results).length,1,"Event report controls must load exactly once");
      assert.equal(actual.indexOf(results),actual.indexOf(teams)+1,"Event reports follow existing team controls");
      assert.deepEqual(actual.filter(src => src !== randomEvents && src !== groupRoster && src !== attendanceEvidence && src !== templates && src !== schedules && src !== registrations && src !== teams && src !== results), baseline,
        "All existing Events page scripts must retain their original order");
    } else {
      assert.deepEqual(actual, baseline, page + ": feature scripts were dropped or reordered");
    }
  }
});
test("every public page preloads the upgraded UI without losing its base CSS", () => {
  for (const page of ["index.html", ...keyPages]) {
    const html = read("public/" + page);
    const base = html.search(/styles\.css\?v=\d+/);
    const modern = html.indexOf("/assets/ui-v2.css?v=3");
    const theme = html.search(/\/assets\/snapshot-ui\.css\?v=\d+/);
    assert.ok(base >= 0 && modern > base && theme > modern, page);
    if (page === "index.html" || railPages.has(page)) {
      assert.match(html, /<body class="has-my-stuff-rail">/, page);
    }
  }
});
test("homepage removes species UI only and preserves existing summary scripts", () => {
  const html = read("public/index.html");
  assert.match(html, /class="[^"]*snapshot-home/);
  assert.doesNotMatch(html, /id="species"/);
  assert.doesNotMatch(html, /class="dino-dialog"/);
  assert.match(html, /home-roadmap\.js/);
  assert.match(html, /assets\/site\.js\?v=8/);
  assert.match(html, /assets\/home-v2\.js\?v=3/);
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
  assert.doesNotMatch(nav, /global-player-search/);
  assert.match(nav, /id="territory-admin-nav-link" hidden/);
  assert.match(common, /territoryWarsAdminAccess/);
});
test("CSS preserves semantic red for errors and green for success", () => {
  const theme = read("public/assets/snapshot-ui.css");
  assert.match(theme, /--snap-red:\s*#ef5c65/);
  assert.match(theme, /--snap-green:\s*#30e69a/);
});
