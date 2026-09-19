const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("daily login reward receives the active supporter multiplier", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-daily-supporter-"));
  const names = [
    "AUTOMATION_DB_PATH",
    "WALLET_DAILY_LOGIN_BONUS_ENABLED",
    "WALLET_DAILY_LOGIN_BONUS_COINS",
    "SUPPORTER_COIN_BONUSES_ENABLED",
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.AUTOMATION_DB_PATH = path.join(dir, "economy.sqlite");
  process.env.WALLET_DAILY_LOGIN_BONUS_ENABLED = "true";
  process.env.WALLET_DAILY_LOGIN_BONUS_COINS = "50";
  process.env.SUPPORTER_COIN_BONUSES_ENABLED = "true";

  const modules = [
    "../src/services/economyStore",
    "../src/services/supporterBonusService",
    "../src/services/dailyLoginBonusService",
  ].map(require.resolve);
  for (const modulePath of modules) delete require.cache[modulePath];

  const supporter = require("../src/services/supporterBonusService");
  const daily = require("../src/services/dailyLoginBonusService");

  t.after(() => {
    supporter._test.clearCache();
    for (const modulePath of modules) delete require.cache[modulePath];
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const steamId = "76561198000000071";
  supporter.replaceMemberships(
    [steamId],
    [{ steamId, entitled: true, tier: "guardian" }]
  );

  const result = daily.claim(steamId, { now: new Date("2026-09-19T00:00:00.000Z") });
  assert.equal(result.baseAmount, 50);
  assert.equal(result.supporterTier, "guardian");
  assert.equal(result.supporterMultiplier, 3);
  assert.equal(result.supporterBonusCoins, 100);
  assert.equal(result.amount, 150);
  assert.equal(result.wallet.balance, 150);
  assert.equal(result.transaction.kind, "daily_login_bonus");
  assert.equal(result.transaction.metadata.supporterMultiplier, 3);
});
