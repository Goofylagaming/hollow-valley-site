"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function read(name) {
  return fs.readFileSync(path.join(__dirname, "..", name), "utf8");
}

test("lobby hooks and new arcade files stay self-contained", () => {
  const html = read("public/arcade.html");
  const lobby = read("public/assets/arcade.js");
  const games = read("public/assets/arcade-games.js");
  const board = read("public/assets/arcade-leaderboard.js");
  const fx = read("public/assets/arcade-fx.js");
  const css = read("public/assets/arcade-extras.css");
  assert.match(html, /id="arcade-leaderboard"[^>]*hidden/);
  assert.match(html, /id="arcade-crate-stage"/);
  assert.match(html, /id="arcade-leaderboard-list"/);
  assert.equal((html.match(/id="arcade-leaderboard"/g) || []).length, 1);
  assert.match(html, /arcade-games\.js/);
  assert.match(html, /arcade-leaderboard\.js/);
  assert.match(html, /arcade-fx\.js/);
  assert.match(html, /arcade-extras\.css/);
  assert.doesNotMatch(html, /higher-lower|memory-match|reaction|arcade-extra-games/);
  assert.match(lobby, /GAME_CARDS\.push/);
  assert.match(lobby, /id: 'higher-lower'/);
  assert.match(lobby, /id: 'memory-match'/);
  assert.match(lobby, /id: 'reaction'/);
  assert.match(lobby, /noteCrateOpen/);
  assert.match(lobby, /celebrateCrate/);
  assert.match(lobby, /animateXp/);
  assert.match(lobby, /HollowValleyArcade = \{ refresh, status \}/);
  assert.match(games, /higher-lower/);
  assert.match(games, /memory-match/);
  assert.match(games, /reaction/);
  assert.match(games, /\/signal/);
  assert.match(games, /\/flip/);
  assert.doesNotMatch(games, /round\.opens|opens\s*-\s*Date|reactionMs\s*:/);
  assert.match(board, /\/api\/valley-arcade\/weekly/);
  assert.match(board, /bragging rights only/);
  assert.match(board, /response\.status === 401/);
  assert.match(board, /if \(rendered\) return/);
  assert.match(games, /async function recover/);
  assert.ok(games.indexOf("await startGame(game)") < games.indexOf("epoch += 1"));
  assert.doesNotMatch(games, /arcade-extra-games/);
  assert.match(fx, /arcade-crate-stage/);
  assert.match(read("public/index.html"), /href="\/merch"/);
  assert.match(read("public/partials/nav.html"), /href="\/merch"/);
  assert.match(fx, /hv-arcade-sound/);
  assert.match(fx, /localStorage\.getItem\(SOUND_KEY\) === "1"/);
  assert.match(fx, /prefers-reduced-motion/);
  assert.match(fx, /AudioContext/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  for (const source of [games, board, fx, css]) {
    assert.doesNotMatch(source, /https?:\/\/|cdn\.|jsdelivr|googleapis|unpkg/i);
    assert.doesNotMatch(source, /steamId|steam_id/i);
  }
  for (const file of ["public/assets/arcade-games.js", "public/assets/arcade-leaderboard.js", "public/assets/arcade-fx.js", "public/assets/arcade.js"]) {
    const checked = spawnSync(process.execPath, ["--check", path.join(__dirname, "..", file)], { encoding: "utf8" });
    assert.equal(checked.status, 0, checked.stderr);
  }
});
