const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function restoreEnv(previous) {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

test("supporter membership lookup is batched and maps official ×2/×3/×5 multipliers", async (t) => {
  const names = [
    "SUPPORTER_COIN_BONUSES_ENABLED",
    "HOLLOW_VALLEY_API_BASE_URL",
    "HOLLOW_VALLEY_API_TOKEN",
    "SUPPORTER_MEMBERSHIP_TIMEOUT_MS",
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.SUPPORTER_COIN_BONUSES_ENABLED = "true";
  process.env.HOLLOW_VALLEY_API_BASE_URL = "https://hollowvalley.example";
  process.env.HOLLOW_VALLEY_API_TOKEN = "supporter-bonus-secret";

  const servicePath = require.resolve("../src/services/supporterBonusService");
  delete require.cache[servicePath];
  const supporter = require(servicePath);
  t.after(() => {
    supporter._test.clearCache();
    delete require.cache[servicePath];
    restoreEnv(previous);
  });

  const ids = [
    "76561198000000051",
    "76561198000000052",
    "76561198000000053",
    "76561198000000054",
  ];
  let calls = 0;
  const summary = await supporter.refreshMemberships(ids, {
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.equal(url, "https://hollowvalley.example/api/internal/supporter-memberships");
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, "Bearer supporter-bonus-secret");
      assert.deepEqual(JSON.parse(options.body), { steamIds: ids });
      return {
        ok: true,
        json: async () => ({
          memberships: [
            { steamId: ids[0], entitled: true, tier: "supporter" },
            { steamId: ids[1], entitled: true, tier: "guardian" },
            { steamId: ids[2], entitled: true, tier: "legend" },
            { steamId: ids[3], entitled: false, tier: null },
          ],
        }),
      };
    },
  });

  assert.equal(calls, 1);
  assert.deepEqual(summary, { skipped: false, requested: 4, entitled: 3 });
  assert.equal(supporter.applyBonus(100, ids[0]).payoutCoins, 200);
  assert.equal(supporter.applyBonus(100, ids[1]).payoutCoins, 300);
  assert.equal(supporter.applyBonus(100, ids[2]).payoutCoins, 500);
  assert.equal(supporter.applyBonus(100, ids[3]).payoutCoins, 100);

  await assert.rejects(
    supporter.refreshMemberships([ids[0]], {
      fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    }),
    /HTTP 503/
  );
  assert.equal(supporter.applyBonus(100, ids[0]).payoutCoins, 100);
});

test("supporter bonus multiplies the already quest-boosted playtime payout", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-supporter-reward-"));
  const names = [
    "AUTOMATION_DB_PATH",
    "WALLET_PLAYTIME_REWARDS_ENABLED",
    "WALLET_PLAYTIME_COINS_PER_5_MINUTES",
    "WALLET_PLAYTIME_MAX_SAMPLE_GAP_SECONDS",
    "WALLET_QUEST_DAILY_1H_BOOST_PERCENT",
    "WALLET_QUEST_DAILY_3H_BOOST_PERCENT",
    "WALLET_QUEST_DAILY_6H_BOOST_PERCENT",
    "WALLET_QUEST_WEEKLY_12H_BOOST_PERCENT",
    "WALLET_QUEST_WEEKLY_24H_BOOST_PERCENT",
    "WALLET_QUEST_MAX_TOTAL_BOOST_PERCENT",
    "SUPPORTER_COIN_BONUSES_ENABLED",
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));

  process.env.AUTOMATION_DB_PATH = path.join(dir, "economy.sqlite");
  process.env.WALLET_PLAYTIME_REWARDS_ENABLED = "true";
  process.env.WALLET_PLAYTIME_COINS_PER_5_MINUTES = "20";
  process.env.WALLET_PLAYTIME_MAX_SAMPLE_GAP_SECONDS = "90";
  process.env.WALLET_QUEST_DAILY_1H_BOOST_PERCENT = "25";
  process.env.WALLET_QUEST_DAILY_3H_BOOST_PERCENT = "0";
  process.env.WALLET_QUEST_DAILY_6H_BOOST_PERCENT = "0";
  process.env.WALLET_QUEST_WEEKLY_12H_BOOST_PERCENT = "0";
  process.env.WALLET_QUEST_WEEKLY_24H_BOOST_PERCENT = "0";
  process.env.WALLET_QUEST_MAX_TOTAL_BOOST_PERCENT = "100";
  process.env.SUPPORTER_COIN_BONUSES_ENABLED = "true";

  const modules = [
    "../src/services/economyStore",
    "../src/services/questBoostService",
    "../src/services/supporterBonusService",
    "../src/services/playtimeRewardsService",
  ].map(require.resolve);
  for (const modulePath of modules) delete require.cache[modulePath];

  const store = require("../src/services/economyStore");
  const quests = require("../src/services/questBoostService");
  const supporter = require("../src/services/supporterBonusService");
  const rewards = require("../src/services/playtimeRewardsService");

  t.after(() => {
    supporter._test.clearCache();
    for (const modulePath of modules) delete require.cache[modulePath];
    restoreEnv(previous);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const steamId = "76561198000000055";
  const player = [{ steamId }];
  const start = Date.parse("2026-09-18T00:00:00.000Z");

  supporter.replaceMemberships(
    [steamId],
    [{ steamId, entitled: true, tier: "supporter" }]
  );

  rewards.rewardOnlinePlayers(player, { nowMs: start });
  quests.updateQuestProgress(steamId, {
    elapsedSeconds: 3600,
    continuous: true,
    nowMs: start + 3600_000,
  });

  rewards.rewardOnlinePlayers(player, { nowMs: start + 3600_000 });
  for (let minute = 61; minute <= 65; minute += 1) {
    rewards.rewardOnlinePlayers(player, { nowMs: start + minute * 60_000 });
  }

  const wallet = store.getWallet(steamId);
  assert.equal(wallet.balance, 50);
  assert.equal(wallet.transactions.length, 1);
  const tx = wallet.transactions[0];
  assert.equal(tx.amount, 50);
  assert.equal(tx.metadata.baseCoins, 20);
  assert.equal(tx.metadata.questBoostPercent, 25);
  assert.equal(tx.metadata.questBonusCoins, 5);
  assert.equal(tx.metadata.questBoostedCoins, 25);
  assert.equal(tx.metadata.supporterTier, "supporter");
  assert.equal(tx.metadata.supporterMultiplier, 2);
  assert.equal(tx.metadata.supporterBonusCoins, 25);
  assert.equal(tx.metadata.payoutCoins, 50);
});


test("legacy member and elite membership records normalize to official multipliers", (t) => {
  process.env.SUPPORTER_COIN_BONUSES_ENABLED = "true";
  const servicePath = require.resolve("../src/services/supporterBonusService");
  delete require.cache[servicePath];
  const supporter = require(servicePath);
  t.after(() => {
    supporter._test.clearCache();
    delete require.cache[servicePath];
  });

  const memberId = "76561198000000061";
  const eliteId = "76561198000000062";
  supporter.replaceMemberships(
    [memberId, eliteId],
    [
      { steamId: memberId, entitled: true, tier: "member" },
      { steamId: eliteId, entitled: true, tier: "elite" },
    ]
  );

  assert.equal(supporter.membershipForSteamId(memberId).tier, "supporter");
  assert.equal(supporter.membershipForSteamId(memberId).multiplier, 2);
  assert.equal(supporter.membershipForSteamId(eliteId).tier, "guardian");
  assert.equal(supporter.membershipForSteamId(eliteId).multiplier, 3);
});
