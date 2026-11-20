"use strict";

process.env.DB_PATH = ":memory:";
process.env.AUTOMATION_DB_PATH = ":memory:";
process.env.HOLLOW_VALLEY_API_TOKEN = "daily-login-route-test-token";
process.env.DAILY_LOGIN_REWARDS_ENABLED = "1";
process.env.MEMBERSHIP_REWARDS_ENABLED = "1";
process.env.WALLET_DAILY_LOGIN_BONUS_ENABLED = "true";
process.env.WALLET_DAILY_LOGIN_BONUS_COINS = "50";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { db } = require("../server/db");
require("../server/services/supporterWebhook");
const economy = require("../automation-platform/src/services/economyStore");
const { requireWebsiteToken } = require("../automation-platform/src/middleware/websiteAuth");

const players = {
  base: { id: 710, username: "Daily Base", steam_id: "76561198000000710", is_admin: 0 },
  supporter: { id: 711, username: "Daily Supporter", steam_id: "76561198000000711", is_admin: 0 },
  legacy: { id: 712, username: "Daily Legacy", steam_id: "76561198000000712", is_admin: 0 },
  blocked: { id: 714, username: "Legacy Receipt", steam_id: "76561198000000714", is_admin: 0 },
  nosteam: { id: 713, username: "No Steam", steam_id: null, is_admin: 0 },
};

function balanceOf(steamId) {
  return economy.getWallet(steamId).balance;
}

function ledgerCount(steamId, kind) {
  return economy.db.prepare(
    "SELECT count(*) AS n FROM economy_wallet_ledger WHERE steam_id = ? AND kind = ?"
  ).get(steamId, kind).n;
}

async function listen(app) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

async function call(url, resource, { method = "GET", user, body, origin } = {}) {
  const headers = {};
  if (user) headers["x-user"] = user;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (origin) headers.origin = origin;
  const response = await fetch(url + resource, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  return { status: response.status, payload };
}

test("streak daily login status and claims stay on one payout", async (t) => {
  for (const user of Object.values(players)) {
    db.prepare("INSERT INTO users (id, username, steam_id, is_admin) VALUES (?, ?, ?, ?)").run(
      user.id, user.username, user.steam_id, user.is_admin
    );
  }
  db.prepare(
    `INSERT INTO supporter_subscriptions (user_id, tier, auto_renew, renews_at, stripe_status)
     VALUES (?, 'supporter', 1, ?, 'active')`
  ).run(players.supporter.id, new Date(Date.now() + 30 * 86400000).toISOString());

  const automation = express();
  automation.use(express.json());
  const walletRead = express.Router();
  walletRead.use(requireWebsiteToken);
  walletRead.get("/:steamId", (req, res) => {
    try { return res.json(economy.getWallet(req.params.steamId)); }
    catch (error) { return res.status(400).json({ error: error.message }); }
  });
  automation.use("/api/website/wallet", walletRead);
  automation.use("/api/website/admin-wallet", require("../automation-platform/src/routes/websiteAdminWalletRoutes"));
  automation.use("/api/website/daily-login", require("../automation-platform/src/routes/websiteDailyLoginRoutes"));
  const automationServer = await listen(automation);
  t.after(() => new Promise((resolve) => automationServer.server.close(resolve)));
  process.env.AUTOMATION_SERVICE_URL = automationServer.url;

  const site = express();
  site.use(express.json());
  site.use((req, _res, next) => {
    const key = req.get("x-user");
    if (key && players[key]) req.user = players[key];
    next();
  });
  site.use("/api/wallet", require("../server/routes/wallet"));
  site.use("/api/daily-bonus", require("../server/routes/dailybonus"));
  site.use("/api/supporter", require("../server/routes/membershipRewards"));
  const siteServer = await listen(site);
  t.after(() => new Promise((resolve) => siteServer.server.close(resolve)));

  assert.equal((await call(siteServer.url, "/api/wallet/daily-login")).status, 401);
  assert.equal((await call(siteServer.url, "/api/wallet/daily-login/claim", { method: "POST" })).status, 401);
  assert.equal((await call(siteServer.url, "/api/daily-bonus", { user: "nosteam" })).status, 400);
  assert.equal((await call(siteServer.url, "/api/daily-bonus/claim", { method: "POST", user: "nosteam" })).status, 400);

  const legacyClaim = await fetch(
    `${automationServer.url}/api/website/daily-login/${players.base.steam_id}/claim`,
    { method: "POST", headers: { Authorization: `Bearer ${process.env.HOLLOW_VALLEY_API_TOKEN}` } }
  );
  assert.equal(legacyClaim.status, 503);
  assert.equal((await legacyClaim.json()).code, "DAILY_LOGIN_BONUS_DISABLED");
  assert.equal(balanceOf(players.base.steam_id), 0);

  const status = await call(siteServer.url, "/api/wallet/daily-login", { user: "base" });
  assert.equal(status.status, 200);
  assert.equal(status.payload.mode, "streak");
  assert.equal(status.payload.automaticClaim, false);
  assert.equal(status.payload.enabled, true);
  assert.equal(status.payload.claimed, false);
  assert.equal(status.payload.claimable, true);
  assert.equal(status.payload.amount, 500);
  assert.equal(status.payload.cycleDay, 1);
  assert.deepEqual(status.payload.amounts, [500, 750, 1000, 1250, 1500, 2000, 3000]);

  const bonusStatus = await call(siteServer.url, "/api/daily-bonus", { user: "base" });
  assert.equal(bonusStatus.status, 200);
  assert.equal(bonusStatus.payload.claimable, true);
  assert.equal(bonusStatus.payload.day, status.payload.day);

  const automatic = await call(siteServer.url, "/api/wallet/daily-login/claim", { method: "POST", user: "base" });
  assert.equal(automatic.status, 200);
  assert.equal(automatic.payload.duplicate, true);
  assert.equal(automatic.payload.automaticClaimSuppressed, true);
  assert.equal(automatic.payload.amount, 0);
  assert.equal(automatic.payload.claimable, true);
  assert.equal(balanceOf(players.base.steam_id), 0);
  assert.equal(ledgerCount(players.base.steam_id, "daily_login_reward"), 0);
  assert.equal(ledgerCount(players.base.steam_id, "daily_login_bonus"), 0);

  const claimed = await call(siteServer.url, "/api/daily-bonus/claim", { method: "POST", user: "base" });
  assert.equal(claimed.status, 201);
  assert.equal(claimed.payload.duplicate, false);
  assert.equal(claimed.payload.awarded, true);
  assert.equal(claimed.payload.amount, 500);
  assert.equal(claimed.payload.claimed, true);
  assert.equal(claimed.payload.claimable, false);
  assert.equal(claimed.payload.wallet.balance, 500);
  assert.equal(claimed.payload.cycleDay, 1);
  assert.equal(balanceOf(players.base.steam_id), 500);
  assert.equal(ledgerCount(players.base.steam_id, "daily_login_reward"), 1);

  const duplicate = await call(siteServer.url, "/api/daily-bonus/claim", { method: "POST", user: "base" });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.payload.duplicate, true);
  assert.equal(duplicate.payload.claimed, true);
  assert.equal(duplicate.payload.amount, 500);
  assert.equal(duplicate.payload.wallet.balance, 500);
  assert.equal(balanceOf(players.base.steam_id), 500);

  const supporterClaim = await call(siteServer.url, "/api/supporter/rewards/daily", {
    method: "POST",
    user: "base",
    body: { day: status.payload.day },
    origin: siteServer.url,
  });
  assert.equal(supporterClaim.status, 200);
  assert.equal(supporterClaim.payload.eligible, false);
  assert.equal(balanceOf(players.base.steam_id), 500);
  assert.equal(ledgerCount(players.base.steam_id, "daily_login_reward"), 1);

  const after = await call(siteServer.url, "/api/wallet/daily-login", { user: "base" });
  assert.equal(after.payload.claimed, true);
  assert.equal(after.payload.claimable, false);
  assert.equal(after.payload.amount, 500);

  const supporterStatus = await call(siteServer.url, "/api/daily-bonus", { user: "supporter" });
  assert.equal(supporterStatus.payload.amount, 550);
  assert.equal(supporterStatus.payload.baseAmount, 500);
  assert.equal(supporterStatus.payload.bonus, 50);
  assert.equal(supporterStatus.payload.percent, 10);
  const supporterAward = await call(siteServer.url, "/api/daily-bonus/claim", { method: "POST", user: "supporter" });
  assert.equal(supporterAward.status, 201);
  assert.equal(supporterAward.payload.amount, 550);
  assert.equal(supporterAward.payload.duplicate, false);
  assert.equal(balanceOf(players.supporter.steam_id), 550);
  const supporterAgain = await call(siteServer.url, "/api/wallet/daily-login/claim", { method: "POST", user: "supporter" });
  assert.equal(supporterAgain.status, 200);
  assert.equal(supporterAgain.payload.duplicate, true);
  assert.equal(supporterAgain.payload.automaticClaimSuppressed, true);
  assert.equal(balanceOf(players.supporter.steam_id), 550);

  const blockedStatus = await call(siteServer.url, "/api/wallet/daily-login", { user: "blocked" });
  economy.applyWalletTransaction({
    steamId: players.blocked.steam_id,
    amount: 1000,
    kind: "daily_login_bonus",
    reason: "legacy",
    idempotencyKey: `daily-login:${players.blocked.steam_id}:${blockedStatus.payload.day}`,
    referenceId: blockedStatus.payload.day,
  });
  const blockedClaim = await call(siteServer.url, "/api/daily-bonus/claim", { method: "POST", user: "blocked" });
  assert.equal(blockedClaim.status, 200);
  assert.equal(blockedClaim.payload.duplicate, true);
  assert.equal(blockedClaim.payload.claimed, true);
  assert.equal(balanceOf(players.blocked.steam_id), 1000);
  assert.equal(ledgerCount(players.blocked.steam_id, "daily_login_reward"), 0);

  delete process.env.DAILY_LOGIN_REWARDS_ENABLED;
  const legacyStatus = await call(siteServer.url, "/api/wallet/daily-login", { user: "legacy" });
  assert.equal(legacyStatus.status, 200);
  assert.equal(legacyStatus.payload.mode, undefined);
  assert.equal(legacyStatus.payload.enabled, true);
  assert.equal(legacyStatus.payload.amount, 50);
  assert.equal(legacyStatus.payload.claimed, false);
  assert.equal(legacyStatus.payload.claimable, true);

  const legacyFirst = await call(siteServer.url, "/api/wallet/daily-login/claim", { method: "POST", user: "legacy" });
  assert.equal(legacyFirst.status, 201);
  assert.equal(legacyFirst.payload.duplicate, false);
  assert.equal(legacyFirst.payload.amount, 50);
  assert.equal(balanceOf(players.legacy.steam_id), 50);
  assert.equal(ledgerCount(players.legacy.steam_id, "daily_login_bonus"), 1);

  const legacySecond = await call(siteServer.url, "/api/daily-bonus/claim", { method: "POST", user: "legacy" });
  assert.equal(legacySecond.status, 200);
  assert.equal(legacySecond.payload.duplicate, true);
  assert.equal(balanceOf(players.legacy.steam_id), 50);
  const legacyRead = await call(siteServer.url, "/api/daily-bonus", { user: "legacy" });
  assert.equal(legacyRead.payload.claimed, true);
  assert.equal(legacyRead.payload.claimable, false);

  process.env.DAILY_LOGIN_REWARDS_ENABLED = "1";
  const disabled = await call(siteServer.url, "/api/wallet/daily-login/claim", { method: "POST", user: "legacy" });
  assert.equal(disabled.status, 200);
  assert.equal(disabled.payload.duplicate, true);
  assert.equal(disabled.payload.automaticClaimSuppressed, true);
  assert.equal(balanceOf(players.legacy.steam_id), 50);
  assert.equal(ledgerCount(players.legacy.steam_id, "daily_login_reward"), 0);
});

test("daily reward clients keep the payout event and explicit claim copy", () => {
  const read = (relative) => fs.readFileSync(path.join(__dirname, "..", relative), "utf8");
  const common = read("public/assets/common.js");
  const wallet = read("public/assets/wallet.js");
  const rewards = read("public/assets/daily-rewards.js");
  const statusAt = common.indexOf('api("/api/wallet/daily-login")');
  const claimAt = common.indexOf('api("/api/wallet/daily-login/claim"');
  assert.ok(statusAt > -1 && claimAt > statusAt);
  assert.match(common, /status\?\.mode === "streak" \|\| status\?\.automaticClaim === false/);
  assert.match(common, /automaticClaimSuppressed/);
  assert.match(common, /hds:daily-login-bonus/);
  assert.match(common, /showDailyRewardReady/);
  assert.match(common, /showDailyLoginAward/);
  assert.match(wallet, /Already claimed/);
  assert.match(wallet, /daily_login_reward/);
  assert.match(wallet, /Claim today's reward/);
  assert.match(rewards, /hds:daily-login-bonus/);
  assert.match(rewards, /payload\?\.eligible === false/);
});
