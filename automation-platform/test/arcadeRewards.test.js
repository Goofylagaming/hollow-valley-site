'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
process.env.AUTOMATION_DB_PATH=':memory:';
process.env.VALLEY_ARCADE_ENABLED='1';process.env.VALLEY_ARCADE_REWARDS_ENABLED='1';
const rewards=require('../src/services/arcadeRewards');
const arcade=require('../src/services/valleyArcade');
const games=require('../src/services/valleyArcadeGames');
const store=require('../src/services/economyStore');
const db=store.db;
const steam='76561198000000100',other='76561198000000101';
let serial=0;const key=()=>`test-key-${++serial}`;
const now=Date.parse('2026-11-06T02:00:00Z');
function setup(){arcade.configure('admin',{enabled:true,emergency:false,cap:250000});rewards.schema();}
function pool(rows){const c=rewards.config();c.crates.valley=rows;return rewards.configure('admin',c,c.version);}
function crate(id=steam){return rewards.grant('admin',id,key(),{kind:'crate',family:'valley',amount:1,source:'event'},now).crateIds[0];}
setup();
test('additive schema preserves wallet data and repeated initialization',()=>{
  store.ensureWallet(steam);db.prepare('UPDATE economy_wallets SET balance=1234 WHERE steam_id=?').run(steam);
  rewards.schema();rewards.schema();assert.equal(store.getWallet(steam).balance,1234);
  assert.equal(rewards.state(steam,now).level,1);
});
test('Brisbane daily rollover, natural idempotency and no paid input',()=>{
  const before=Date.parse('2026-11-06T13:59:59.999Z');
  assert.equal(rewards.daily(steam,key(),before).duplicate,false);
  assert.equal(rewards.daily(steam,key(),before).duplicate,true);
  assert.equal(rewards.daily(steam,key(),before+1).duplicate,false);
  assert.equal(rewards.state(steam,before+1).xp,50);
  assert.throws(()=>rewards.grant('admin',steam,key(),{kind:'crate',family:'prime',amount:1,source:'subscription'}),/earned source/);
});
test('cryptographic weighted picker boundaries and published odds',()=>{
  const p=[{weight:9,id:'a'},{weight:1,id:'b'}];
  assert.equal(rewards.weighted(p,()=>0).id,'a');assert.equal(rewards.weighted(p,()=>8).id,'a');
  assert.equal(rewards.weighted(p,()=>9).id,'b');assert.throws(()=>rewards.weighted(p,()=>10));
  assert.deepEqual(rewards.odds(steam,p).map(x=>x.probability),[.9,.1]);
});
test('owned crate snapshot, atomic coin ledger and replay/conflict protection',()=>{
  pool([{id:'coin',label:'77 VC',type:'coins',amount:77,weight:1}]);
  const c=crate(),request=key(),balance=store.getWallet(steam).balance;
  pool([{id:'coin',label:'999 VC',type:'coins',amount:999,weight:1}]);
  assert.throws(()=>rewards.open(other,key(),c),/not found/);
  assert.equal(rewards.open(steam,request,c).reward.amount,77);
  assert.equal(rewards.open(steam,request,c).duplicate,true);
  assert.equal(rewards.open(steam,key(),c).alreadyOpened,true);
  assert.equal(store.getWallet(steam).balance,balance+77);
  assert.equal(db.prepare('SELECT count(*) AS n FROM economy_wallet_ledger WHERE reference_id=?').get(c).n,1);
  assert.throws(()=>rewards.craft(steam,request,'valley'),/conflicts/);
});
test('wallet failure rolls back crate consumption, receipt and audit',()=>{
  const c=crate(other);store.ensureWallet(other);
  db.prepare('UPDATE economy_wallets SET balance=? WHERE steam_id=?').run(Number.MAX_SAFE_INTEGER,other);
  const request=key();assert.throws(()=>rewards.open(other,request,c),/limit/);
  assert.equal(db.prepare('SELECT opened_at FROM arcade_crates WHERE id=?').get(c).opened_at,null);
  assert.equal(db.prepare('SELECT count(*) AS n FROM arcade_reward_receipts WHERE steam_id=? AND request_key=?').get(other,request).n,0);
  db.prepare('UPDATE economy_wallets SET balance=0 WHERE steam_id=?').run(other);
  assert.equal(rewards.open(other,request,c).reward.amount,999);
});
test('fragments cannot go negative and crafting is retry safe',()=>{
  rewards.grant('admin',steam,key(),{kind:'fragments',family:'prime',amount:25,source:'quest'});
  const request=key(),result=rewards.craft(steam,request,'prime');
  assert.equal(rewards.craft(steam,request,'prime').crateId,result.crateId);
  assert.throws(()=>rewards.craft(steam,key(),'prime'),/Not enough/);
  assert.equal(rewards.state(steam).fragments.find(f=>f.family==='prime').quantity,0);
});
test('failure after wallet credit rolls back every write including the ledger',()=>{
  const c=crate(),balance=store.getWallet(steam).balance;
  db.exec("CREATE TRIGGER reject_arcade_audit BEFORE INSERT ON arcade_rewards_audit WHEN NEW.action='open' BEGIN SELECT RAISE(ABORT,'audit failure'); END");
  try {assert.throws(()=>rewards.open(steam,key(),c),/audit failure/);}
  finally {db.exec('DROP TRIGGER reject_arcade_audit');}
  assert.equal(store.getWallet(steam).balance,balance);
  assert.equal(db.prepare('SELECT count(*) AS n FROM economy_wallet_ledger WHERE reference_id=?').get(c).n,0);
  assert.equal(db.prepare('SELECT opened_at FROM arcade_crates WHERE id=?').get(c).opened_at,null);
});
test('Skin Studio unlocks, owned conversion, reroll odds and all-owned fallback',()=>{
  db.prepare("INSERT INTO economy_skin_presets(id,species,name,skin_json) VALUES ('arcade-test-skin','Omniraptor','Test','{}')").run();
  const skin={id:'skin',label:'Test skin',type:'skin',presetId:'arcade-test-skin',duplicate:'convert',duplicateCoins:30,weight:1};
  pool([skin]);assert.equal(rewards.open(steam,key(),crate()).reward.type,'skin');
  assert.equal(store.hasSkinUnlock(steam,'arcade-test-skin'),true);
  assert.equal(rewards.open(steam,key(),crate()).reward.amount,30);
  pool([{...skin,duplicate:'reroll'},{id:'coin',label:'42 VC',type:'coins',amount:42,weight:1}]);
  const odds=rewards.state(steam).catalog.find(c=>c.family==='valley').odds;
  assert.deepEqual(odds.map(r=>r.probability),[0,1]);
  assert.equal(rewards.open(steam,key(),crate()).reward.amount,42);
  pool([{...skin,duplicate:'reroll'}]);assert.equal(rewards.open(steam,key(),crate()).reward.amount,30);
});
test('unavailable skin preserves unopened crate',()=>{
  const c=crate(other);db.prepare("UPDATE economy_skin_presets SET active=0 WHERE id='arcade-test-skin'").run();
  assert.throws(()=>rewards.open(other,key(),c),/unavailable/);
  assert.equal(db.prepare('SELECT opened_at FROM arcade_crates WHERE id=?').get(c).opened_at,null);
  db.prepare("UPDATE economy_skin_presets SET active=1 WHERE id='arcade-test-skin'").run();
});
test('dinosaur rewards are permanent owner-bound entitlements with configured growth',()=>{
  pool([{id:'dino',label:'49% Omniraptor',type:'dinosaur',species:'Omniraptor',growthPercent:49,weight:1}]);
  const c=crate(),result=rewards.open(steam,key(),c);rewards.open(steam,key(),c);
  const row=db.prepare('SELECT * FROM arcade_entitlements WHERE id=?').get(result.reward.entitlementId);
  assert.equal(row.steam_id,steam);assert.equal(JSON.parse(row.reward_json).growthPercent,49);
  assert.equal(rewards.state(other).entitlements.length,0);
});
test('configuration validates weights/growth and rejects stale versions',()=>{
  const c=rewards.config();assert.throws(()=>rewards.configure('admin',c,c.version-1),/changed/);
  c.crates.valley[0].growthPercent=101;assert.throws(()=>rewards.configure('admin',c,c.version),/whole-number/);
  c.crates.valley[0].growthPercent=49;c.crates.valley[0].weight=-1;assert.throws(()=>rewards.configure('admin',c,c.version),/whole-number/);
});
test('free plays are daily bounded, start retries do not consume twice, wins grant once',()=>{
  const id='76561198000000102',c=rewards.config();c.dailyPlays=1;rewards.configure('admin',c,c.version);
  const request=key(),round=games.start(id,'trivia',now,request);
  assert.equal(games.start(id,'trivia',now,request).id,round.id);
  assert.throws(()=>games.start(id,'trivia',now+5000,key()),/free plays/);
  const solution=db.prepare('SELECT solution FROM arcade_challenges WHERE round_id=?').get(round.id).solution;
  games.answer(id,round.id,solution,now);games.answer(id,round.id,solution,now);
  assert.equal(rewards.state(id,now).xp,c.winXp);
  assert.equal(rewards.state(id,now).fragments[0].quantity,1);
  assert.equal(rewards.state(id,now+86400000).playsRemaining,1);
});
test('level milestones grant once and emergency pause preserves inventory',()=>{
  const id='76561198000000103';for(let i=0;i<4;i++)rewards.grant('admin',id,`milestone-${i}`,{kind:'xp',amount:500,source:'achievement'});
  assert.equal(rewards.state(id).level,5);assert.equal(rewards.state(id).crates.length,1);
  rewards.grant('admin',id,'milestone-3',{kind:'xp',amount:500,source:'achievement'});
  const c=rewards.state(id).crates[0].id;
  arcade.configure('admin',{enabled:true,emergency:true,cap:250000});
  assert.throws(()=>rewards.open(id,key(),c),/paused/);assert.throws(()=>rewards.daily(id,key()),/paused/);
  setup();assert.equal(rewards.state(id).crates.length,1);
});
