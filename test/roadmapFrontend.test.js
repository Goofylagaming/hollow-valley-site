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
    "public/assets/admin.js",
    "public/assets/adminoperations.js",
    "public/assets/admincomms.js",
    "public/assets/adminsupporters.js",
    "public/assets/wallet.js",
    "public/assets/quests.js",
    "public/assets/profile.js",
    "public/assets/leaderboard.js",
    "public/assets/livemap.js",
    "public/assets/events.js",
  ]) {
    assert.doesNotThrow(() => new Function(read(file)), file);
  }
});

test("shared navigation exposes Wallet and Quests as separate tabs", () => {
  const nav = read("public/partials/nav.html");
  assert.equal(nav.includes('href="/">Command</a>'), false);
  assert.equal(nav.includes('href="/#join">How to join</a>'), false);
  assert.equal(nav.includes('href="/wallet">WALLET</a>'), true);
  assert.equal(nav.includes('href="/quests">QUESTS</a>'), true);
  assert.equal(nav.includes('href="/profile"'), true);
  assert.equal(nav.includes('href="/leaderboard?tab=levels"'), true);
  assert.equal(nav.includes('href="/#wallet"'), false);
  assert.equal(nav.includes('href="/#quests"'), false);
  assert.match(nav, /id="admin-nav-group" hidden/);
  assert.match(nav, /HOLLOW VALLEY/);
});

test("legacy dashboard redirects to the dedicated wallet page", () => {
  const html = read("public/dashboard.html");
  assert.match(html, /content="0;url=\/wallet"/);
  assert.match(html, /window\.location\.replace\("\/wallet"\)/);
  assert.match(html, /Open Wallet/);
});

test("Quests are restored as a dedicated automatic-progress page", () => {
  const homepage = read("public/index.html");
  const html = read("public/quests.html");
  const js = read("public/assets/quests.js");
  assert.equal(homepage.includes('id="quests"'), false);
  assert.match(html, /Valley challenges\./);
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

test("permanent progression profile uses the shared Steam-keyed automation source", () => {
  const html = read("public/profile.html");
  const js = read("public/assets/profile.js");
  const route = read("server/routes/progression.js");
  const client = read("server/services/automationWebsiteClient.js");
  const service = read("automation-platform/src/services/progressionService.js");
  const websiteRoutes = read("automation-platform/src/routes/websiteRoutes.js");

  assert.match(html, /PERMANENT PROGRESSION/);
  assert.match(html, /every level awards 100 Valley Coin/);
  assert.match(js, /\/api\/progression/);
  assert.match(js, /\/api\/wallet/);
  assert.match(js, /\/api\/supporter/);
  assert.match(js, /\/api\/friends/);
  assert.match(html, /MY STUFF · PROFILE/);
  assert.match(html, /ACCOUNT LINKS/);
  assert.match(js, /Hollow Valley Apex/);
  assert.match(route, /linkProgressionIdentity/);
  assert.match(client, /function getProgression/);
  assert.match(client, /function getProgressionLeaderboard/);
  assert.match(websiteRoutes, /leaderboards\/progression/);
  assert.match(service, /LEVEL_REWARD_VC = 100/);
  assert.match(service, /PLAYTIME_XP_PER_5_MINUTES = 10/);
  assert.match(service, /progression_level_reward/);
  const nav = read("public/partials/nav.html");
  assert.match(nav, /My profile/);
});


test("website server status reuses the automation snapshot instead of duplicate RCON polling", () => {
  const status = read("server/services/serverStatus.js");
  const client = read("server/services/automationWebsiteClient.js");

  assert.match(status, /if \(automationConfigured\(\)\) \{\s*return automation\.getServerSnapshot\(\);/s);
  assert.match(status, /const fallback = usingAutomation \? 15_000 : 300_000/);
  assert.match(status, /const minimum = usingAutomation \? 10_000 : 300_000/);
  assert.match(status, /Math\.max\(minimum, Math\.min\(600_000/);
  assert.match(status, /source: automationConfigured\(\) \? "automation-cache" : "direct-rcon"/);
  assert.match(client, /function getServerSnapshot\(\)/);
  assert.match(client, /call\('\/server-snapshot'\)/);
});

test("admin operations page is admin-only and contains no automation admin token", () => {
  const html = read("public/adminoperations.html");
  const js = read("public/assets/adminoperations.js");
  const nav = read("public/partials/nav.html");
  assert.match(nav, /id="admin-nav-group" hidden/);
  assert.match(html, /ADMIN · OPERATIONS/);
  assert.match(js, /\/api\/admin-operations/);
  assert.equal(html.includes("AUTOMATION_ADMIN_TOKEN"), false);
  assert.equal(js.includes("AUTOMATION_ADMIN_TOKEN"), false);
});

test("leaderboard uses only verified automation sources for playtime and combat", () => {
  const html = read("public/leaderboard.html");
  const js = read("public/assets/leaderboard.js");
  const route = read("server/routes/leaderboards.js");
  const client = read("server/services/automationWebsiteClient.js");
  const websiteRoutes = read("automation-platform/src/routes/websiteRoutes.js");
  const combat = read("automation-platform/src/services/combatEventService.js");

  assert.match(html, /Playtime · 31 days/);
  assert.match(html, /authoritative combat feed/);
  assert.match(js, /Verified minutes · 31 days/);
  assert.match(js, /Combat ranking unavailable/);
  assert.match(js, /No verified combat events/);
  assert.match(route, /getPlaytimeLeaderboard/);
  assert.match(route, /getCombatLeaderboard/);
  assert.match(route, /getProgressionLeaderboard/);
  assert.match(html, /data-tab="mostLevels"/);
  assert.match(js, /mostLevels/);
  assert.equal(route.includes("../db"), false);
  assert.equal(route.includes("getLeaderboards"), false);
  assert.match(client, /leaderboards\/playtime/);
  assert.match(client, /leaderboards\/combat/);
  assert.match(websiteRoutes, /leaderboards\/combat/);
  assert.match(combat, /COMBAT_FEED_ENABLED/);
  assert.match(combat, /COMBAT_EVENT_CONFLICT/);
});

test("admin Comms page is admin-only and uses server-side automation proxy", () => {
  const html = read("public/admincomms.html");
  const js = read("public/assets/admincomms.js");
  const nav = read("public/partials/nav.html");
  assert.match(nav, /id="admin-nav-group" hidden/);
  assert.match(html, /ADMIN · COMMS/);
  assert.match(js, /\/api\/admin-comms/);
  assert.equal(html.includes("HERBYBOT_AUTOMATION_TOKEN"), false);
  assert.equal(js.includes("HERBYBOT_AUTOMATION_TOKEN"), false);
  assert.equal(html.includes("AUTOMATION_ADMIN_TOKEN"), false);
  assert.equal(js.includes("AUTOMATION_ADMIN_TOKEN"), false);
});

test("Live Map keeps offline history separate from live coordinates", () => {
  const html = read("public/livemap.html");
  const js = read("public/assets/livemap.js");
  const route = read("server/routes/map.js");
  const client = read("server/services/automationWebsiteClient.js");

  assert.match(html, /id="map-history-grid"/);
  assert.match(html, /Offline periods never display stale coordinates as live positions/);
  assert.match(js, /\/api\/map\/activity\?hours=24/);
  assert.match(js, /renderMarkers\(null\)/);
  assert.match(js, /no player positions are shown/);
  assert.match(js, /ACTIVE_REFRESH_MS = 5_000/);
  assert.match(js, /HIDDEN_REFRESH_MS = 30_000/);
  assert.match(js, /visibilitychange/);
  assert.match(route, /router\.get\("\/activity"/);
  assert.match(client, /function getMapActivity/);
  assert.match(client, /\/map\/activity\?hours=/);
});

test("Events page supports RSVP, admin-confirmed attendance payouts and custom bonuses", () => {
  const html = read("public/events.html");
  const js = read("public/assets/events.js");
  const route = read("server/routes/events.js");
  const client = read("server/services/automationWebsiteClient.js");
  const wallet = read("public/assets/wallet.js");
  const attendance = read("automation-platform/src/services/eventAttendanceService.js");

  assert.match(html, /YOUR EVENT REWARDS/);
  assert.match(html, /id="event-admin-panel" hidden/);
  assert.match(html, /ATTENDING LIST/);
  assert.match(html, /CUSTOM BONUS/);
  assert.match(html, /Confirm all attendees/);
  assert.match(js, /\/api\/events\/attendance/);
  assert.match(js, /\/api\/events\/admin\/attendance\/confirm/);
  assert.match(js, /\/api\/events\/admin\/bonus/);
  assert.match(js, /They attended/);
  assert.match(route, /requireAdmin/);
  assert.match(route, /admin\/attendance\/add/);
  assert.match(client, /confirmAdminEventAttendance/);
  assert.match(client, /awardAdminEventBonus/);
  assert.match(wallet, /event_attendance_reward/);
  assert.match(wallet, /event_bonus_reward/);
  assert.match(attendance, /ATTENDANCE_BASE_VC_DEFAULT = 10000/);
  assert.match(attendance, /supporter: 1\.5/);
  assert.match(attendance, /guardian: 3/);
  assert.match(attendance, /legend: 5/);
  assert.match(attendance, /event_attendance_reward/);
  assert.match(attendance, /event_bonus_reward/);
});

test("consolidated admin hub replaces scattered admin navigation", () => {
  const html = read("public/admin.html");
  const js = read("public/assets/admin.js");
  const nav = read("public/partials/nav.html");
  const server = read("server/index.js");

  assert.match(nav, /id="admin-nav-group" hidden/);
  assert.match(nav, /href="\/admin"/);
  assert.match(nav, /href="\/adminoperations"/);
  assert.match(nav, /href="\/admincomms"/);
  assert.match(nav, /href="\/adminrestore"/);
  assert.equal(nav.includes('id="admin-operations-nav"'), false);
  assert.equal(nav.includes('id="admin-comms-nav"'), false);
  assert.equal(nav.includes('id="admin-restore-nav"'), false);
  assert.match(html, /Admin hub\./);
  assert.match(html, /System health/);
  assert.match(html, /Discord automation/);
  assert.match(html, /Event rewards/);
  assert.match(js, /\/api\/admin-operations/);
  assert.match(js, /\/api\/admin-comms/);
  assert.match(js, /\/api\/events\/admin\/rewards/);
  assert.match(js, /\/api\/admin-restore/);
  assert.match(server, /ADMIN_PAGE_ROUTES/);
  assert.match(server, /requireAdmin/);
});


test("admin supporter roster exposes paid members, Steam IDs and Discord role repair", () => {
  const html = read("public/adminsupporters.html");
  const js = read("public/assets/adminsupporters.js");
  const route = read("server/routes/adminSupporters.js");
  const server = read("server/index.js");
  const admin = read("public/admin.html");

  assert.match(html, /Supporter roster\./);
  assert.match(html, /MISSING DISCORD/);
  assert.match(html, /Steam ID/);
  assert.match(js, /\/api\/admin-supporters/);
  assert.match(js, /Sync Discord role/);
  assert.match(js, /PAID · DISCORD NOT LINKED/);
  assert.match(js, /PAID · WEBSITE ACCOUNT NOT MATCHED/);
  assert.match(js, /Repair membership/);
  assert.match(js, /Copy Steam ID/);
  assert.match(route, /supporter_subscriptions/);
  assert.match(route, /stripe_customer_id/);
  assert.match(route, /stripe_subscription_id/);
  assert.match(route, /v1\/subscriptions/);
  assert.match(route, /repair-stripe/);
  assert.match(route, /needsWebsiteLink/);
  assert.match(route, /needsReconcile/);
  assert.match(route, /requireAdmin/);
  assert.match(route, /syncDiscordMembershipForUser/);
  assert.match(route, /upsertSupporter/);
  assert.match(server, /adminSupportersRouter/);
  assert.match(server, /adminsupporters: "adminsupporters\.html"/);
  assert.match(admin, /href="\/adminsupporters"/);
});

test("Supporter account panel makes Steam and Discord linkage explicit", () => {
  const html = read("public/supporter.html");
  const js = read("public/assets/supporter.js");
  const route = read("server/routes/supporter.js");

  assert.match(html, /ACCOUNT LINKS/);
  assert.match(html, /id="supporter-account-status"/);
  assert.match(js, /STEAM ACCOUNT/);
  assert.match(js, /DISCORD ACCOUNT/);
  assert.match(js, /DISCORD SUPPORTER ROLE/);
  assert.match(js, /\/auth\/steam\?returnTo=\/supporter/);
  assert.match(js, /\/auth\/discord/);
  assert.match(js, /syncDiscordAccount/);
  assert.match(js, /Link Steam first/);
  assert.match(route, /STEAM_LINK_REQUIRED/);
  assert.match(route, /requireSteamLink/);
});


test("Discord event calendar is sourced through HerbyBot and automation", () => {
  const route = read("server/routes/events.js");
  const client = read("server/services/automationWebsiteClient.js");
  const herbyRoute = read("automation-platform/src/routes/herbyBotRoutes.js");
  const websiteRoute = read("automation-platform/src/routes/websiteRoutes.js");
  const service = read("automation-platform/src/services/discordEventService.js");

  assert.equal(route.includes("DISCORD_BOT_TOKEN"), false);
  assert.equal(route.includes("discord.com/api"), false);
  assert.match(route, /getDiscordScheduledEvents/);
  assert.match(client, /function getDiscordScheduledEvents/);
  assert.match(herbyRoute, /events\/sync/);
  assert.match(websiteRoute, /router\.get\('\/events'/);
  assert.match(service, /discord:scheduled-events/);
  assert.match(service, /staleAfterMs/);
});

test("quest page presents 36h and 72h as weekly quests", () => {
  const js = read("public/assets/quests.js");
  assert.match(js, /weekly-total-36h/);
  assert.match(js, /Go Touch Grass/);
  assert.match(js, /weekly-total-72h/);
  assert.match(js, /What Life\?/);
  assert.match(js, /weekly reset/);
  assert.match(js, /APPROVED QUEST POOL/);
  assert.equal(js.includes("LIFETIME PLAYTIME"), false);
  assert.equal(js.includes("/api/progression"), false);
});


test("Prime Tracker backend remains wired to verified presence samples", () => {
  const websiteRoutes = read("automation-platform/src/routes/websiteRoutes.js");
  const presence = read("automation-platform/src/services/playerPresenceService.js");
  const prime = read("automation-platform/src/services/primeTrackerService.js");
  const myDinos = read("public/assets/mydinos.js");
  const env = read("automation-platform/.env.example");

  assert.match(websiteRoutes, /primeTrackerService/);
  assert.match(websiteRoutes, /router\.get\('\/prime\/:steamId'/);
  assert.match(presence, /recordPrimeSnapshot\(players, sampledAt\)/);
  assert.match(presence, /recordPrimeSnapshot\(players, nowIso\)/);
  assert.match(prime, /function enabled/);
  assert.match(prime, /PRIME_TRACKER_ENABLED/);
  assert.match(prime, /function trackerState/);
  assert.match(myDinos, /\/api\/mydinos\/prime-tracker/);
  assert.match(env, /PRIME_TRACKER_ENABLED=false/);
});
