const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Dino Storage is a top-level tab beside My Stuff and My Dinos is renamed Dino History", () => {
  const nav = read("public/partials/nav.html");
  assert.match(nav, /href="\/mydinos"[^>]*>.*Dino History/s);
  assert.match(nav, /href="\/dinostorage\/">DINO STORAGE<\/a>/);

  const myStuff = nav.indexOf("MY STUFF");
  const storage = nav.indexOf("DINO STORAGE");
  const wallet = nav.indexOf("WALLET");
  assert.ok(myStuff >= 0 && storage > myStuff && wallet > storage);
});

test("Dino Storage page contains storage only, without Prime or survivor-listing panels", () => {
  const html = read("public/dinostorage/index.html");
  assert.match(html, /Dino Storage\./);
  assert.match(html, /id="storage-grid"/);
  assert.match(html, /mydinos\.js/);
  assert.doesNotMatch(html, /prime-tracker-card/);
  assert.doesNotMatch(html, /mydinos-marketplace\.js/);
});

test("Dino History no longer loads the DinoStorage frontend", () => {
  const html = read("public/mydinos.html");
  const js = read("public/assets/dinohistory.js");
  assert.match(html, /Dino history\./);
  assert.match(html, /dinohistory\.js/);
  assert.doesNotMatch(html, /id="storage-grid"/);
  assert.doesNotMatch(html, /mydinos\.js/);
  assert.match(js, /\/api\/mydinos\/prime-tracker/);
});

test("survivor listing management remains in Marketplace", () => {
  const html = read("public/marketplace.html");
  const js = read("public/assets/marketplace-mine.js");
  assert.match(html, /Your survivor listings\./);
  assert.match(html, /marketplace-mine\.js/);
  assert.match(js, /\/api\/marketplace\/listings\/mine/);
  assert.match(js, /Dino Storage/);
});
