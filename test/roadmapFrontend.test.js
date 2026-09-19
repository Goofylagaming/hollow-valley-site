const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relative) {
  return fs.readFileSync(path.join(__dirname, "..", relative), "utf8");
}

test("roadmap browser scripts parse", () => {
  for (const file of [
    "public/assets/common.js",
    "public/assets/dashboard.js",
    "public/assets/site.js",
    "public/assets/marketplace.js",
    "public/assets/mydinos.js",
    "public/assets/skins.js",
    "public/assets/supporter.js",
    "public/assets/adminrestore.js",
  ]) {
    assert.doesNotThrow(() => new Function(read(file)), file);
  }
});

test("shared navigation removes Command and How to Join and keeps Admin Restore hidden", () => {
  const nav = read("public/partials/nav.html");
  assert.equal(nav.includes('href="/">Command</a>'), false);
  assert.equal(nav.includes('href="/#join">How to join</a>'), false);
  assert.match(nav, /id="admin-restore-nav" hidden/);
  assert.match(nav, /HOLLOW VALLEY/);
});

test("dashboard has one prominent wallet balance and official supporter multiplier", () => {
  const html = read("public/dashboard.html");
  assert.equal((html.match(/id="dash-wallet"/g) || []).length, 1);
  assert.match(html, /dashboard-wallet-corner/);
  assert.match(html, /id="dash-supporter-multiplier"/);
  assert.match(html, /VALLEY COIN · LIVE REWARDS/);
});

test("homepage quests are automatic progress with no manual claim buttons", () => {
  const html = read("public/index.html");
  const js = read("public/assets/site.js");
  assert.match(html, /Verified online time completes these automatically/);
  assert.match(js, /progressSeconds/);
  assert.match(js, /boostPercent/);
  assert.equal(js.includes("quest-claim"), false);
});

test("homepage wallet shows supporter multiplier, daily login reward and species browser", () => {
  const html = read("public/index.html");
  const js = read("public/assets/site.js");
  assert.match(html, /wallet-supporter-multiplier/);
  assert.match(html, /DAILY LOGIN BONUS/);
  assert.match(js, /supporterMultiplier/);
  assert.match(js, /daily_login_bonus/);
  assert.match(js, /loadDailyBonus/);
  assert.match(js, /loadSpecies/);
  assert.match(js, /walletActivityDetail/);
});

test("daily bonus route uses the Steam-linked automation wallet only", () => {
  const route = read("server/routes/dailybonus.js");
  assert.match(route, /getDailyLoginBonus/);
  assert.match(route, /claimDailyLoginBonus/);
  assert.equal(route.includes("creditWallet"), false);
  assert.equal(route.includes("Math.random"), false);
});

test("Admin Restore browser page never contains an automation admin token", () => {
  const html = read("public/adminrestore.html");
  const js = read("public/assets/adminrestore.js");
  assert.equal(html.includes("AUTOMATION_ADMIN_TOKEN"), false);
  assert.equal(js.includes("AUTOMATION_ADMIN_TOKEN"), false);
  assert.match(js, /\/api\/admin-restore/);
});
