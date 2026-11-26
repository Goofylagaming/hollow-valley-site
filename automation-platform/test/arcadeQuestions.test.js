const test = require("node:test");
const assert = require("node:assert/strict");

process.env.AUTOMATION_DB_PATH = ":memory:";
process.env.VALLEY_ARCADE_ENABLED = "1";
delete process.env.VALLEY_ARCADE_REWARDS_ENABLED;

const arcade = require("../src/services/valleyArcade");
const games = require("../src/services/valleyArcadeGames");
const { trivia, guess } = require("../src/data/arcade-questions");

function assertBank(name, rows) {
  const prompts = new Set();
  for (const row of rows) {
    assert.equal(row.length, 4, name);
    const [prompt, answer, wrongA, wrongB] = row.map((part) => String(part || "").trim());
    assert.ok(prompt.length > 12, prompt);
    assert.ok(answer && wrongA && wrongB);
    assert.notEqual(answer, wrongA);
    assert.notEqual(answer, wrongB);
    assert.notEqual(wrongA, wrongB);
    assert.equal(prompts.has(prompt), false, prompt);
    prompts.add(prompt);
    assert.doesNotMatch(`${prompt} ${answer} ${wrongA} ${wrongB}`, /\b\d{17}\b|\b\d+\s+Valley Coins\b|hours to grow/i);
  }
}

test("trivia and guess-the-dino use a 60 item Hollow Valley pool", () => {
  assert.equal(trivia.length, 40);
  assert.equal(guess.length, 20);
  assertBank("trivia", trivia);
  assertBank("guess", guess);
  const overlap = trivia.filter((row) => guess.some((other) => other[0] === row[0]));
  assert.deepEqual(overlap, []);
  const gallimimus = guess.find((row) => row[1] === "Gallimimus");
  const omniraptor = guess.find((row) => row[1] === "Omniraptor");
  assert.match(gallimimus[0], /quick omnivore scout/);
  assert.deepEqual(gallimimus.slice(2), ["Deinosuchus", "Tyrannosaurus"]);
  assert.match(omniraptor[0], /feathered raptor and a pack hunter/);
  assert.doesNotMatch(omniraptor[0], /omnivore scout/);
  assert.ok(omniraptor.includes("Gallimimus"));
});

test("served rounds come from the bank, hide the answer, and keep the 500 coin payout", () => {
  arcade.configure("test-admin", { enabled: true, emergency: false, cap: 250000 });
  const id = "76561198000000640";
  let now = Date.parse("2026-11-20T01:00:00.000Z");
  for (const [game, bank] of [["trivia", trivia], ["guess-the-dino", guess]]) {
    for (let i = 0; i < 8; i += 1) {
      const round = games.start(id, game, now);
      assert.equal(round.solution, undefined);
      assert.equal(round.game, game);
      const row = bank.find((item) => item[0] === round.prompt);
      assert.ok(row, round.prompt);
      assert.deepEqual([...round.choices].sort(), [row[1], row[2], row[3]].sort());
      const wrong = games.answer(id, round.id, row[2], now);
      assert.equal(wrong.score, 0);
      assert.equal(wrong.payout, 0);
      assert.equal(wrong.duplicate, false);
      now += 5000;
      const retry = games.start(id, game, now);
      const retryRow = bank.find((item) => item[0] === retry.prompt);
      const correct = games.answer(id, retry.id, retryRow[1], now);
      assert.equal(correct.score, 1);
      assert.equal(correct.payout, 500);
      assert.equal(correct.duplicate, false);
      const again = games.answer(id, retry.id, retryRow[1], now);
      assert.equal(again.duplicate, true);
      assert.equal(again.payout, 500);
      now += 5000;
    }
  }
});
