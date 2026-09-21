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
    "public/assets/adminoperations.js",
    "public/assets/wallet.js",
    "public/assets/quests.js",
    "public/assets/events.js",
  ]) {
    assert.doesNotThrow(() => new Function(read(file)), file);
  }
});

test("shared navigation exposes Wallet and Quests as separate tabs", () => {
  const nav = read("public/partials/nav.html");
  assert.equal(nav.includes('href="/">Command</a>'), false);
  assert.equal(nav.includes('href="/#join">How to join</a>'), false);
  assert.match(nav, /href="\/wallet">Wallet<\/a>/);
  assert.match(nav, /href="\/quests">Quests<\/a>/);
  assert.equal(nav.includes('href="/#wallet"'), false);
  assert.equal(nav.includes('href="/#quests"'), false);
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

test("Quests are restored as a dedicated automatic-progress page", () => {
  const homepage = read("public/index.html");
  const html = read("public/quests.html");
  const js = read("public/assets/quests.js");
  assert.equal(homepage.includes('id="quests"'), false);
  assert.match(html, /Your quests\./);
  assert.match(html, /ACTIVE COIN BOOST/);
  assert.match(js, /progressSeconds/);
  assert.match(js, /boostPercent/);
  assert.match(js, /\/api\/quests/);
  assert.equal(js.includes("quest-claim"), false);
});

test("Wallet is restored as a dedicated Steam-linked page", () => {
  const homepage = read("public/index.html");
  const html = read("public/wallet.html");
  const js = read("public/assets/wallet.js");
  assert.equal(homepage.includes('id="wallet"'), false);
  assert.match(html, /Your wallet\./);
  assert.match(html, /CURRENT BALANCE/);
  assert.match(html, /SUPPORTER/);
  assert.match(js, /supporterMultiplier/);
  assert.match(js, /\/api\/wallet/);
  assert.match(js, /wallet-transactions/);
});

test("daily bonus route uses the Steam-linked automation wallet only", () => {
  const route = read("server/routes/dailybonus.js");
  assert.match(route, /getDailyLoginBonus/);
  assert.match(route, /claimDailyLoginBonus/);
  assert.equal(route.includes("creditWallet"), false);
  assert.equal(route.includes("Math.random"), false);
});

test("marketplace exposes order history and richer P2P listing details without changing write gates", () => {
  const html = read("public/marketplace.html");
  const js = read("public/assets/marketplace.js");
  const route = read("server/routes/marketplace.js");
  const client = read("server/services/automationWebsiteClient.js");
  const myDinos = read("public/assets/mydinos.js");

  assert.match(html, /YOUR STORE ORDERS/);
  assert.match(html, /YOUR LISTINGS/);
  assert.match(html, /id="my-orders-section"/);
  assert.match(html, /id="my-listings-section"/);
  assert.match(js, /loadMyOrders/);
  assert.match(js, /loadMyListings/);
  assert.match(js, /listingSkinPreview/);
  assert.match(js, /p2pCancelEnabled/);
  assert.match(route, /\/orders\/mine/);
  assert.match(route, /listMarketplaceOrders/);
  assert.match(client, /function listMarketplaceOrders/);
  assert.match(client, /\/marketplace\/orders\//);
  assert.match(myDinos, /stored-sell/);
  assert.match(myDinos, /p2pWritesEnabled/);
});

test("Admin Restore browser page never contains an automation admin token", () => {
  const html = read("public/adminrestore.html");
  const js = read("public/assets/adminrestore.js");
  assert.equal(html.includes("AUTOMATION_ADMIN_TOKEN"), false);
  assert.equal(js.includes("AUTOMATION_ADMIN_TOKEN"), false);
  assert.match(js, /\/api\/admin-restore/);
});


test("supporter page uses current Hollow Valley portal branding", () => {
  const html = read("public/supporter.html");
  assert.match(html, /© 2026 Hollow Valley/);
  assert.match(html, /HOME OF THE HERBY DEATH SQUAD/);
  assert.equal(html.includes("© 2026 Herby Death Squad Games"), false);
});

test("server exposes Wallet and Quests as dedicated page routes", () => {
  const server = read("server/index.js");
  assert.match(server, /"wallet"/);
  assert.match(server, /"quests"/);
});


test("website server status reuses the automation snapshot instead of duplicate RCON polling", () => {
  const status = read("server/services/serverStatus.js");
  const client = read("server/services/automationWebsiteClient.js");

  assert.match(status, /if \(automationConfigured\(\)\) \{\s*return automation\.getServerSnapshot\(\);/s);
  assert.match(status, /automationConfigured\(\) \? 60_000 : 120_000/);
  assert.match(status, /source: automationConfigured\(\) \? "automation-cache" : "direct-rcon"/);
  assert.match(client, /function getServerSnapshot\(\)/);
  assert.match(client, /call\('\/server-snapshot'\)/);
});

test("admin operations page is admin-only and contains no automation admin token", () => {
  const html = read("public/adminoperations.html");
  const js = read("public/assets/adminoperations.js");
  const nav = read("public/partials/nav.html");
  assert.match(nav, /id="admin-operations-nav" hidden/);
  assert.match(html, /ADMIN · OPERATIONS/);
  assert.match(js, /\/api\/admin-operations/);
  assert.equal(html.includes("AUTOMATION_ADMIN_TOKEN"), false);
  assert.equal(js.includes("AUTOMATION_ADMIN_TOKEN"), false);
});

test("Discord Events page auto-refreshes from Discord and shows sync state", () => {
  const html = read("public/events.html");
  const js = read("public/assets/events.js");
  const route = read("server/routes/events.js");
  const bot = read("server/herbyBot.js");

  assert.match(html, /Discord Scheduled Events are the source of truth/);
  assert.match(html, /id="event-sync-state"/);
  assert.match(js, /REFRESH_INTERVAL_MS = 30_000/);
  assert.match(js, /\/api\/events/);
  assert.match(js, /Discord events synced/);
  assert.match(route, /discordEvents\.listScheduledEvents/);
  assert.match(bot, /guildScheduledEventCreate/);
  assert.match(bot, /guildScheduledEventUpdate/);
  assert.match(bot, /guildScheduledEventDelete/);
  assert.match(bot, /discordEvents\.invalidateCache/);
});
