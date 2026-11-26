"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
process.env.AUTOMATION_DB_PATH = ":memory:";
process.env.VALLEY_ARCADE_ENABLED = "1";
const games = require("../src/services/valleyArcadeGames");
const arcade = require("../src/services/valleyArcade");
const economy = require("../src/services/economyStore");
const db = economy.db;

arcade.configure("fairness-admin", { enabled: true, emergency: false, cap: null });

function stored(id) {
  return db.prepare("SELECT solution, opens, closes, board_json, go_token FROM arcade_challenges WHERE round_id=?").get(id);
}

test("hidden games stay server-judged and do not leak a perfect play", async (t) => {
  const higher = "76561198000000640";
  const memory = "76561198000000641";
  const reaction = "76561198000000642";
  const legacy = "76561198000000643";
  let now = Date.parse("2026-11-24T01:00:00.000Z");

  await t.test("higher or lower hides the next count and still pays 500", () => {
    economy.ensureWallet(higher);
    const before = economy.getWallet(higher).balance;
    const round = games.start(higher, "higher-lower", now);
    const row = stored(round.id);
    assert.equal(round.solution, undefined);
    assert.equal(round.board, undefined);
    assert.equal(round.preview, undefined);
    assert.equal(JSON.stringify(round).includes('"solution"'), false);
    const won = games.answer(higher, round.id, row.solution, now + 10);
    assert.equal(won.score, 1);
    assert.equal(won.payout, games.PAYOUT);
    assert.equal(games.PAYOUT, 500);
    assert.equal(economy.getWallet(higher).balance, before + 500);
    const lost = games.start(higher, "higher-lower", now + 10000);
    assert.equal(games.answer(higher, lost.id, lost.choices.find(choice => choice !== stored(lost.id).solution), now + 10010).score, 0);
  });

  await t.test("memory match reveals only the flipped cards", () => {
    const round = games.start(memory, "memory-match", now);
    const board = JSON.parse(stored(round.id).board_json);
    assert.equal(round.preview, undefined);
    assert.equal(round.board, undefined);
    assert.equal(round.solution, undefined);
    assert.equal(round.cardCount, 6);
    assert.deepEqual(round.choices, ["1", "2", "3", "4", "5", "6"]);
    for (const symbol of ["Egg", "Claw", "Fern"]) assert.equal(JSON.stringify(round).includes(symbol), false);
    assert.equal(games.answer(memory, round.id, stored(round.id).solution, now + 20).score, 0);

    const second = games.start(memory, "memory-match", now + 20000);
    const cards = JSON.parse(stored(second.id).board_json);
    const first = games.flip(memory, second.id, 1, now + 20001);
    assert.equal(first.symbol, cards[0]);
    assert.equal(first.pair, undefined);
    for (const symbol of ["Egg", "Claw", "Fern"]) {
      if (symbol !== cards[0]) assert.equal(JSON.stringify(first).includes(symbol), false);
    }
    const other = cards.findIndex(symbol => symbol !== cards[0]);
    const mismatch = games.flip(memory, second.id, other + 1, now + 20002);
    assert.equal(mismatch.matched, false);
    assert.equal(mismatch.mismatch, true);
    assert.deepEqual(mismatch.pair, { position: 1, symbol: cards[0] });
    assert.equal(mismatch.matchedPositions.length, 0);
    const hidden = ["Egg", "Claw", "Fern"].find(symbol => symbol !== cards[0] && symbol !== cards[other]);
    assert.equal(JSON.stringify(mismatch).includes(hidden), false);
    assert.throws(() => games.flip(memory, second.id, [1, 2], now + 20003), /Unknown card/);

    const third = games.start(memory, "memory-match", now + 40000);
    const solved = JSON.parse(stored(third.id).board_json);
    const remaining = solved.map((symbol, index) => ({ symbol, position: index + 1 }));
    let result;
    let at = now + 40010;
    while (remaining.length) {
      const card = remaining.shift();
      const partnerAt = remaining.findIndex(item => item.symbol === card.symbol);
      const partner = remaining.splice(partnerAt, 1)[0];
      const opened = games.flip(memory, third.id, card.position, at);
      assert.equal(opened.complete, false);
      result = games.flip(memory, third.id, partner.position, at + 1);
      at += 2;
    }
    assert.equal(result.complete, true);
    assert.equal(result.score, 1);
    assert.equal(result.payout, 500);
    assert.equal(games.flip(memory, third.id, 1, at).duplicate, true);
  });

  await t.test("reaction go-time is hidden and judged on the server clock", () => {
    const round = games.start(reaction, "reaction", now);
    const row = stored(round.id);
    assert.equal(round.state, "wait");
    assert.equal(round.opens, undefined);
    assert.equal(round.closes, undefined);
    assert.equal(round.solution, undefined);
    assert.ok(row.opens >= now + games.REACTION_COUNTDOWN_MS + 400);
    assert.ok(row.opens < now + games.REACTION_COUNTDOWN_MS + 2200);
    assert.equal(row.closes - row.opens, games.REACTION_WINDOW_MS);
    assert.equal(games.signal(reaction, round.id, now + 500).count, 3);
    assert.equal(games.signal(reaction, round.id, now + 1500).count, 2);
    assert.equal(games.signal(reaction, round.id, now + 2500).count, 1);
    const waiting = games.signal(reaction, round.id, now + 3200);
    assert.equal(waiting.state, "wait");
    assert.equal(waiting.token, undefined);
    assert.equal(waiting.opens, undefined);
    const go = games.signal(reaction, round.id, row.opens);
    assert.deepEqual(Object.keys(go).sort(), ["state", "token"]);
    assert.equal(go.state, "go");
    assert.match(go.token, /^[a-f0-9]{32}$/);
    const tooFast = games.answer(reaction, round.id, "Tap", row.opens + games.REACTION_MIN_MS - 1, go.token);
    assert.equal(tooFast.score, 0);
    assert.equal(tooFast.payout, 0);
    assert.equal(tooFast.tooFast, true);
    assert.equal(tooFast.reactionMs, games.REACTION_MIN_MS - 1);

    const fair = games.start(reaction, "reaction", now + 30000);
    const fairRow = stored(fair.id);
    const token = games.signal(reaction, fair.id, fairRow.opens).token;
    economy.ensureWallet(reaction);
    const before = economy.getWallet(reaction).balance;
    const won = games.answer(reaction, fair.id, "Tap", fairRow.opens + games.REACTION_MIN_MS, token);
    assert.equal(won.score, 1);
    assert.equal(won.payout, 500);
    assert.equal(won.reactionMs, 120);
    assert.equal(economy.getWallet(reaction).balance, before + 500);

    const slow = games.start(reaction, "reaction", now + 60000);
    const slowRow = stored(slow.id);
    const slowToken = games.signal(reaction, slow.id, slowRow.opens).token;
    const missed = games.answer(reaction, slow.id, "Tap", slowRow.closes + 1, slowToken);
    assert.equal(missed.score, 0);
    assert.equal(missed.tooSlow, true);

    const untrusted = games.start(reaction, "reaction", now + 90000);
    const untrustedRow = stored(untrusted.id);
    games.signal(reaction, untrusted.id, untrustedRow.opens);
    assert.equal(games.answer(reaction, untrusted.id, "Tap", untrustedRow.opens + 400, "client-clock").score, 0);
    const guessed = games.start(reaction, "reaction", now + 120000);
    const guessedRow = stored(guessed.id);
    assert.equal(games.answer(reaction, guessed.id, "Tap", guessedRow.opens + 400).score, 0);
    assert.equal(games.answer(reaction, guessed.id, "Tap", guessedRow.opens + 400, stored(guessed.id).go_token).duplicate, true);
  });

  await t.test("a memory board finished in time still pays after the round clock", () => {
    const steam = "76561198000000644";
    const startAt = Date.parse("2026-11-24T13:59:00.000Z");
    const completedAt = startAt + 30000;
    const round = games.start(steam, "memory-match", startAt);
    const row = stored(round.id);
    db.prepare("UPDATE arcade_challenges SET flip_json=? WHERE round_id=?").run(
      JSON.stringify({ pending: null, matched: [1, 2, 3, 4, 5, 6], completedAt }), round.id);
    economy.ensureWallet(steam);
    const before = economy.getWallet(steam).balance;
    const late = games.flip(steam, round.id, 1, row.closes + 5000);
    assert.equal(late.complete, true);
    assert.equal(late.score, 1);
    assert.equal(late.payout, 500);
    assert.equal(late.expired, undefined);
    assert.equal(economy.getWallet(steam).balance, before + 500);
    assert.equal(db.prepare("SELECT settled_day FROM arcade_rounds WHERE id=?").get(round.id).settled_day, "2026-11-24");
    const retry = games.answer(steam, round.id, "late", row.closes + 9000);
    assert.equal(retry.duplicate, true);
    assert.equal(retry.score, 1);

    const unanswered = games.start(steam, "memory-match", startAt + 70000);
    db.prepare("UPDATE arcade_challenges SET flip_json=? WHERE round_id=?").run(
      JSON.stringify({ pending: null, matched: [1, 2, 3, 4, 5, 6], completedAt: startAt + 71000 }), unanswered.id);
    const paid = games.answer(steam, unanswered.id, "nope", stored(unanswered.id).closes + 8000);
    assert.equal(paid.score, 1);
    assert.equal(paid.payout, 500);

    const open = games.start(steam, "memory-match", startAt + 140000);
    const missed = games.flip(steam, open.id, 1, stored(open.id).closes + 1000);
    assert.equal(missed.score, 0);
    assert.equal(missed.expired, true);
  });

  await t.test("an older challenge table picks up the new columns", () => {
    db.exec("DROP TABLE arcade_challenges");
    db.exec(`CREATE TABLE arcade_challenges (
      round_id TEXT PRIMARY KEY, solution TEXT NOT NULL, opens INTEGER NOT NULL, closes INTEGER NOT NULL)`);
    const round = games.start(legacy, "trivia", now + 150000);
    const columns = db.prepare("PRAGMA table_info(arcade_challenges)").all().map(column => column.name);
    assert.ok(columns.includes("go_token") && columns.includes("board_json") && columns.includes("flip_json"));
    assert.equal(round.solution, undefined);
    assert.equal(games.answer(legacy, round.id, stored(round.id).solution, now + 150010).payout, 500);
  });
});

test("arcade actions take the server clock and ignore client timing fields", () => {
  const route = fs.readFileSync(require.resolve("../src/routes/websiteAdminWalletRoutes.js"), "utf8");
  const block = route.slice(route.indexOf("router.post('/arcade/:action'"), route.indexOf("router.post('/arcade-rewards/:action'"));
  assert.match(block, /games\.answer\(body\.steamId,body\.id,body\.choice,Date\.now\(\),body\.token\)/);
  assert.match(block, /games\.signal\(body\.steamId,body\.id,Date\.now\(\)\)/);
  assert.match(block, /games\.flip\(body\.steamId,body\.id,body\.position,Date\.now\(\)\)/);
  assert.match(block, /valleyArcadeLeaderboard'\)\.weekly\(body\.steamId, Date\.now\(\)\)/);
  assert.doesNotMatch(block, /body\.now|body\.reactionMs|body\.score|body\.opens|body\.payout/);
});
