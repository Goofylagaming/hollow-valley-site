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
    assert.match(html, /href="\/assets\/snapshot-ui\.css\?v=2"/, filename);
  }
});

test("Live Map preloads the new styling before loading map-specific CSS", () => {
  const html = read("public/livemap.html");
  assert.ok(html.indexOf("/assets/snapshot-ui.css?v=2") > 0);
  assert.ok(html.indexOf("/assets/snapshot-ui.css?v=2") < html.indexOf("livemap-trail.css"));
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
