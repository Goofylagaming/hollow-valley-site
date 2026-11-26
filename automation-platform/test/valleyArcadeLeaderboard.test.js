"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
process.env.AUTOMATION_DB_PATH = ":memory:";
process.env.VALLEY_ARCADE_ENABLED = "1";
const arcade = require("../src/services/valleyArcade");
const board = require("../src/services/valleyArcadeLeaderboard");
const rewards = require("../src/services/arcadeRewards");
const economy = require("../src/services/economyStore");
const db = economy.db;

arcade.configure("board-admin", { enabled: true, emergency: false, cap: 250000 });

function add(steamId, day, score, openedAt) {
  db.prepare(`INSERT INTO arcade_rounds(id,steam_id,game,opened_at,settled_day,score,payout)
    VALUES (?,?,?,?,?,?,?)`).run(randomUUID(), steamId, "trivia", openedAt, day, score, score ? 500 : 0);
}

test("weekly board uses the Brisbane Monday and bounds correct plays by the daily cap", () => {
  const mondayStart = Date.parse("2026-11-22T14:00:00.000Z");
  assert.equal(board.weekRange(mondayStart).start, "2026-11-23");
  assert.equal(board.weekRange(mondayStart).end, "2026-11-29");
  assert.equal(board.weekRange(mondayStart).resetAt, Date.parse("2026-11-29T14:00:00.000Z"));
  assert.equal(board.weekRange(mondayStart - 1).start, "2026-11-16");
  assert.equal(rewards.config().dailyPlays, 6);
  assert.equal(rewards.config().winXp, 75);
  assert.equal(rewards.config().xpPerLevel, 500);

  const you = "76561198000000701";
  const leader = "76561198000000702";
  for (let i = 0; i < 8; i++) add(you, "2026-11-23", 1, mondayStart + 1000 + i);
  add(you, "2026-11-24", 1, mondayStart + 86400000);
  add(you, "2026-11-22", 1, mondayStart - 1000);
  add(you, "2026-11-23", 0, mondayStart + 5000);
  for (let i = 0; i < 6; i++) add(leader, "2026-11-23", 1, mondayStart + 2000 + i);
  for (let i = 0; i < 4; i++) add(leader, "2026-11-24", 1, mondayStart + 86400000 + i);
  const pack = [];
  for (let i = 0; i < 10; i++) {
    const steamId = "765611980000007" + String(10 + i);
    pack.push(steamId);
    add(steamId, "2026-11-25", 1, mondayStart + 200000 + i);
  }

  const now = Date.parse("2026-11-25T02:00:00.000Z");
  economy.ensureWallet(you);
  const balance = economy.getWallet(you).balance;
  const ledger = db.prepare("SELECT count(*) AS n FROM economy_wallet_ledger").get().n;
  board.resetCache();
  const first = board.weekly(you, now);
  assert.equal(first.weekStart, "2026-11-23");
  assert.equal(first.entries.length, 10);
  assert.equal(first.entries[0].steamId, leader);
  assert.equal(first.entries[0].score, 10);
  assert.equal(first.you.steamId, you);
  assert.equal(first.you.score, 7);
  assert.equal(first.you.rank, 2);
  assert.equal(first.entries.filter(row => row.steamId === pack[9]).length, 0);
  assert.equal(economy.getWallet(you).balance, balance);
  assert.equal(db.prepare("SELECT count(*) AS n FROM economy_wallet_ledger").get().n, ledger);

  const outsider = "76561198000000799";
  assert.deepEqual(board.weekly(outsider, now + 1000).you, { rank: null, steamId: outsider, score: 0 });
  add(you, "2026-11-25", 1, mondayStart + 300000);
  const cached = board.weekly(you, now + 1000);
  assert.equal(cached.you.score, 7);
  const fresh = board.weekly(you, now + board.CACHE_MS);
  assert.equal(fresh.you.score, 8);

  const isolatedNow = Date.parse("2026-12-09T02:00:00.000Z");
  const week = board.weekRange(isolatedNow);
  const earlier = "76561198000000801";
  const later = "76561198000000802";
  add(later, week.start, 1, 200);
  add(earlier, week.start, 1, 100);
  board.resetCache();
  const ties = board.weekly(later, isolatedNow);
  assert.equal(ties.entries[0].steamId, earlier);
  assert.equal(ties.entries[1].steamId, later);
  assert.equal(ties.you.rank, 2);

  arcade.configure("board-admin", { enabled: true, emergency: true, cap: 250000 });
  assert.throws(() => board.weekly(you, now), /disabled/);
});
