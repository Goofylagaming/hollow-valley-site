"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.DB_PATH = ":memory:";
process.env.SESSION_SECRET = "merch-page-test-secret";
process.env.NODE_ENV = "test";

const { createApp } = require("../server/index");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const HIDDEN_CHROMIE_PRODUCT = "hollow-valley-death-squad-tee-chromie";

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("/merch serves the merch page instead of the homepage", async (t) => {
  const server = await listen(createApp());
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const merch = await fetch(base + "/merch");
  assert.equal(merch.status, 200);
  assert.match(merch.headers.get("content-type") || "", /html/);
  const html = await merch.text();
  assert.match(html, /<title>Merch \| Hollow Valley<\/title>/);
  assert.match(html, /id="nav-slot"/);
  assert.match(html, /Hollow Valley Merch/);
  assert.match(html, /Shop on Fourthwall/);
  assert.match(html, /Already ordered by the Death Squad/);
  assert.match(html, /From US\$35/);
  assert.match(html, /products\/hollow-valley-death-squad-singlet/);
  assert.doesNotMatch(html, new RegExp(HIDDEN_CHROMIE_PRODUCT));
  assert.doesNotMatch(html, /Find your next adventure/);

  const unknown = await fetch(base + "/not-a-merch-page");
  assert.equal(unknown.status, 200);
  const home = await unknown.text();
  assert.match(home, /Find your next adventure/);
  assert.doesNotMatch(home, /Already ordered by the Death Squad/);
});

test("merch stays in the nav and homepage hub, and Chromie has no shop link or price", () => {
  const nav = read("public/partials/nav.html");
  const home = read("public/index.html");
  const page = read("public/merch.html");
  const common = read("public/assets/common.js");
  const server = read("server/index.js");

  assert.match(server, /"reports", "merch"/);
  assert.ok(nav.indexOf('href="/supporter">SUPPORTER') < nav.indexOf('href="/merch">MERCH'));
  assert.ok(nav.indexOf('href="/merch">MERCH') < nav.indexOf('id="help-nav-group"'));
  assert.doesNotMatch(nav, /marketplace[\s\S]{0,80}merch|merch[\s\S]{0,40}Marketplace/i);

  const community = home.slice(home.indexOf('class="home-hub-community"'), home.indexOf('class="home-hub-updates"'));
  assert.match(community, /href="\/merch"/);
  assert.match(community, /<b>Merch<\/b>/);
  assert.match(common, /\/partials\/nav\.html\?v=merch1/);

  const chromie = page.slice(page.indexOf('id="merch-chromie"'), page.indexOf('id="merch-browse"'));
  assert.match(chromie, /Hollow Valley Death Squad Tee, Chromie/);
  assert.match(chromie, /chromie-tee\.webp/);
  assert.doesNotMatch(chromie, /US\$|fourthwall\.com/);
  assert.match(page, /id="merch-singlet"[\s\S]*From US\$35[\s\S]*View on Fourthwall/);
  assert.doesNotMatch(page, new RegExp(HIDDEN_CHROMIE_PRODUCT));
  assert.doesNotMatch(page, /customer photo/i);
  assert.ok(fs.statSync(path.join(root, "public/assets/merch/death-squad-singlet.webp")).size > 1000);
  assert.ok(fs.statSync(path.join(root, "public/assets/merch/chromie-tee.webp")).size > 1000);
});
