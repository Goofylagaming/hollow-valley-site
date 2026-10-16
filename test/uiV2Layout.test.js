const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const railPages = [
  "index.html",
  "profile.html",
  "wallet.html",
  "skins.html",
  "friends.html",
  "groups/index.html",
  "groups/territory-wars/index.html",
  "mydinos.html",
  "mydinos/index.html",
  "mydinos/admin.html",
  "mydinos/parked.html",
  "dinostorage/index.html",
  "bodydrop.html",
  "marketplace.html",
  "marketplace-official.html",
  "marketplace-players.html",
];

test("all My Stuff pages reserve rail width before asynchronous JS navigation", () => {
  for (const filename of railPages) {
    const html = read(`public/${filename}`);
    assert.match(html, /<body class="has-my-stuff-rail">/, filename);
    assert.match(html, /id="nav-slot"/, filename);
    assert.match(html, /href="\/assets\/ui-v2\.css\?v=3"/, filename);
    assert.match(html, /href="\/assets\/snapshot-ui\.css\?v=4"/, filename);
  }
});

test("Live Map preloads the new styling before loading map-specific CSS", () => {
  const html = read("public/livemap.html");
  assert.ok(html.indexOf("/assets/snapshot-ui.css?v=4") > 0);
  assert.ok(html.indexOf("/assets/snapshot-ui.css?v=4") < html.indexOf("livemap-trail.css"));
});

test("tablet/mobile navigation has an accessible menu without dropping links", () => {
  const nav = read("public/partials/nav.html");
  const style = read("public/assets/snapshot-ui.css");
  const behavior = read("public/assets/common.js");

  assert.match(nav, /class="menu-toggle"[^>]*aria-label="Open navigation menu"/);
  assert.match(nav, /aria-controls="primary-nav"/);
  assert.match(nav, /<nav class="main-nav" id="primary-nav"/);
  assert.match(style, /\.snapshot-topbar \.main-nav\.open > a:not\(\[hidden\]\)/);
  assert.match(style, /\.snapshot-topbar \.main-nav > \[hidden\] \{ display:none !important; \}/);
  assert.match(style, /\.snapshot-topbar \.snapshot-topbar-tools \{ display:flex; \}/);
  assert.match(behavior, /event\.key === "Escape"/);
  assert.match(behavior, /setMenuOpen\(false\)/);
});

test("navigation fragment does not inject duplicate stylesheets after first paint", () => {
  const html = read("public/partials/nav.html");
  assert.doesNotMatch(html, /<link[^>]*stylesheet/);
});


const additionalSitePages = [
  "quests.html", "events.html", "leaderboard.html", "livemap.html",
  "supporter.html", "admin.html", "adminoperations.html", "admincomms.html",
  "adminrestore.html", "adminsupporters.html", "adminterritorywars.html",
  "owner-login.html",
];

test("every full website page preloads the unified theme after the legacy layout foundation", () => {
  for (const filename of [...railPages, ...additionalSitePages]) {
    const html = read(`public/${filename}`);
    const old = html.indexOf("styles.css?v=38");
    const modern = html.indexOf("/assets/ui-v2.css?v=3");
    const snapshot = html.indexOf("/assets/snapshot-ui.css?v=4");
    assert.ok(old >= 0 && modern > old && snapshot > modern, filename);
  }
});

test("legacy site colour tokens and old page surfaces are visually superseded by UI-v2", () => {
  const css = read("public/assets/snapshot-ui.css");
  const bridge = css.slice(css.indexOf("/* LEGACY VISUAL PALETTE BRIDGE"));
  assert.ok(bridge.length > 1000, "Missing site-wide legacy theme bridge");
  for (const token of ["--bg:", "--panel:", "--line:", "--gold:", "--green:"]) {
    assert.ok(bridge.includes(token), "Unconverted legacy token " + token);
  }
  for (const selector of [".event-card", ".quest-progress-row", ".admin-hub-card", ".market-state-banner", ".ops-table"]) {
    assert.ok(bridge.includes(selector), "Missing UI override " + selector);
  }
});
