"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function read(name) {
  return fs.readFileSync(path.join(__dirname, "..", name), "utf8");
}

test("arcade drawer markup is a keyboard-accessible shell", () => {
  const html = read("public/arcade.html");
  const shell = read("public/assets/arcade-shell.js");
  const recent = read("public/assets/arcade-recent.js");
  const css = read("public/assets/arcade.css") + read("public/assets/arcade-extras.css");
  assert.match(html, /id="arcade-drawer-toggle"[^>]*aria-controls="arcade-rail"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /id="arcade-rail"/);
  assert.match(html, /id="arcade-rail-games"/);
  assert.match(html, /id="arcade-drawer-close"/);
  assert.match(html, /id="arcade-drawer-backdrop"/);
  assert.match(html, />Games</);
  assert.match(html, />Rewards</);
  assert.match(html, />My Stuff</);
  assert.match(html, /href="#arcade-daily"/);
  assert.match(html, /href="#arcade-crates"/);
  assert.match(html, /href="#arcade-fragments"/);
  assert.match(html, /href="#arcade-skins"/);
  assert.match(html, /href="#my-rewards"/);
  assert.match(html, /href="#arcade-history"/);
  assert.match(html, /How it works/);
  assert.match(html, /id="arcade-recent"/);
  assert.match(html, /arcade-shell\.js/);
  assert.match(html, /arcade-recent\.js/);
  assert.match(shell, /Escape/);
  assert.match(shell, /event\.key !== "Tab"/);
  assert.match(shell, /aria-expanded/);
  assert.match(shell, /inert/);
  assert.match(shell, /aria-modal/);
  assert.match(recent, /\/api\/valley-arcade\/recent-wins/);
  assert.match(recent, /60000/);
  assert.match(recent, /prefers-reduced-motion/);
  assert.match(recent, /response\.status === 401/);
  assert.match(recent, /response\.status === 404/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(read("public/partials/nav.html"), /href="\/merch"/);
  assert.doesNotMatch(html + shell + recent, /roulette|blackjack|coinflip|jackpot/i);
  assert.doesNotMatch(recent, /steamId|steam_id|Valley Coins|\bVC\b/);
  for (const file of ["public/assets/arcade-shell.js", "public/assets/arcade-recent.js", "public/assets/arcade.js", "public/assets/arcade-leaderboard.js"]) {
    const checked = spawnSync(process.execPath, ["--check", path.join(__dirname, "..", file)], { encoding: "utf8" });
    assert.equal(checked.status, 0, checked.stderr);
  }
});
