const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const publicRoot = path.resolve(__dirname, "../public");

test("Hollow Valley primary navigation exposes the Primalbound browser game for everyone", () => {
  const nav = fs.readFileSync(path.join(publicRoot, "partials/nav.html"), "utf8");
  const match = nav.match(/<a\b[^>]*\bid="primalbound-nav-link"[^>]*>[^<]*<\/a>/i);
  assert.ok(match, "Expected a public Primalbound entry in shared navigation");
  const anchor = match[0];
  assert.ok(anchor.includes('href="/primalbound/"'));
  assert.match(anchor, /target="_blank"/);
  assert.match(anchor, /rel="[^"]*noopener[^"]*"/);
  assert.match(anchor, /rel="[^"]*noreferrer[^"]*"/);
  assert.match(anchor, /PRIMALBOUND/);
  assert.doesNotMatch(anchor, /hidden|admin-only|onclick/i);
  assert.ok(nav.indexOf('id="primalbound-nav-link"') < nav.indexOf('id="admin-nav-group"'), "Game link should be outside admin-only controls");
});

test("Home page loads the shared navigation and mobile menu retains external links", () => {
  const home = fs.readFileSync(path.join(publicRoot, "index.html"), "utf8");
  const common = fs.readFileSync(path.join(publicRoot, "assets/common.js"), "utf8");
  const mobileStyles = fs.readFileSync(path.join(publicRoot, "assets/snapshot-ui.css"), "utf8");
  assert.match(home, /id="nav-slot"/);
  assert.match(common, /fetch\("\/partials\/nav\.html\?v=/);
  assert.match(mobileStyles, /\.snapshot-topbar \.main-nav\.open > a:not\(\[hidden\]\)/);
});


test("shared navigation always loads fresh Primalbound URL even if old partial is cached", () => {
  const common = fs.readFileSync(path.join(publicRoot, "assets/common.js"), "utf8");
  const home = fs.readFileSync(path.join(publicRoot, "index.html"), "utf8");
  const server = fs.readFileSync(path.resolve(__dirname, "../server/index.js"), "utf8");
  assert.match(common, /\/partials\/nav\.html\?v=primalbound6/);
  assert.match(common, /primalboundLink\.setAttribute\("href", "\/primalbound\/"\)/);
  assert.match(home, /\/assets\/common\.js\?v=22/);
  assert.match(server, /app\.get\("\/partials\/nav\.html"/);
  assert.match(server, /no-store, max-age=0, must-revalidate/);
});
