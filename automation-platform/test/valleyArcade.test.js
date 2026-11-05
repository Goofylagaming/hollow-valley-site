const test = require("node:test");
const assert = require("node:assert/strict");
process.env.AUTOMATION_DB_PATH = ":memory:";
const arcade = require("../src/services/valleyArcade");
const economy = require("../src/services/economyStore");

test("arcade cap, replay, day rollover, unlimited, emergency control and atomic wallet", () => {
  const id = "76561198000000620";
  const before = Date.parse("2026-11-05T13:59:59.999Z");
  assert.equal(arcade.settings().cap,250000);
  assert.equal(arcade.settings().wageringEnabled,false);
  for (const round of ["a","b","c","d","e","f"]) economy.db.prepare("INSERT INTO arcade_rounds(id,steam_id,game,opened_at) VALUES (?,?,'trivia',?)").run(round,id,before);
  delete process.env.VALLEY_ARCADE_ENABLED;
  assert.throws(() => arcade.settle(id,"a",1,249000,before),/disabled/);
  process.env.VALLEY_ARCADE_ENABLED="1";
  arcade.configure("test-admin",{enabled:true,emergency:false,cap:250000});
  assert.equal(arcade.settle(id,"a",1,249000,before).payout,249000);
  assert.equal(arcade.settle(id,"b",1,5000,before).payout,1000);
  assert.equal(arcade.settle(id,"b",50,100,before).duplicate,true);
  assert.equal(arcade.settle(id,"c",1,5000,before).payout,0);
  arcade.configure("test-admin",{enabled:true,emergency:false,cap:123});
  assert.equal(arcade.settle(id,"d",1,5000,before+1).payout,123);
  arcade.configure("test-admin",{enabled:true,emergency:false,cap:null});
  assert.equal(arcade.settle(id,"e",1,999999,before+1).payout,999999);
  arcade.configure("test-admin",{enabled:true,emergency:true,cap:null});
  assert.throws(() => arcade.settle(id,"f",1,1,before+1),/disabled/);
  assert.equal(economy.getWallet(id).balance,1250122);
});
test("all six server-generated games hide solutions, enforce ownership and reject client prizes", () => {
  const games = require("../src/services/valleyArcadeGames");
  const id = "76561198000000621";
  arcade.configure("test-admin",{enabled:true,emergency:false,cap:null});
  let now=Date.now();
  for (const game of games.games) {
    const round=games.start(id,game,now);
    assert.equal(round.solution,undefined);
    assert.throws(()=>games.start(id,game,now+1),/Wait/);
    assert.throws(()=>games.answer("76561198000000622",round.id,"5000",now),/Unknown/);
    assert.equal(games.answer(id,round.id,{payout:5000},now).payout,0);
    assert.equal(games.answer(id,round.id,round.choices[0],now).duplicate,true);
    now+=61000;
  }
});
