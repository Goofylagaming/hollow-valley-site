const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Dino Storage and Dino History stay accessible inside My Stuff while Wallet remains separate", () => {
  const nav = read("public/partials/nav.html");
  const group = nav.match(/id="my-stuff-nav-group"[\s\S]*?<\/div>\s*<\/div>/)?.[0] || "";
  assert.match(group, /href="\/mydinos"[^>]*>Dino History/);
  assert.match(group, /href="\/dinostorage\/"[^>]*>DINO STORAGE/);
  assert.match(group, /href="\/profile"/);
  assert.match(nav, /href="\/wallet">WALLET<\/a>/);
  assert.match(nav, /href="\/quests">QUESTS<\/a>/);
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
