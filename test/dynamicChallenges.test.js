"use strict";
const test=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {createLegacyStore}=require('../automation-platform/src/services/valleyLegacyStore');
const {createDynamicChallengeStore,periods}=require('../automation-platform/src/services/dynamicChallengeStore');
const A='76561198000000001', B='76561198000000002', MIN=60000;
function setup(t,date='2026-11-05T00:00:00+10:00') {
  let at=Date.parse(date);
  const db=new DatabaseSync(':memory:');
  const s=createLegacyStore(db,{now:()=>at});
  const c=createDynamicChallengeStore(db,{now:()=>at,enabled:()=>true});
  t.after(()=>db.close());
  const row=(species='rex',growth=0.5)=>({steamId:A,species,growth});
  // Exercise the real snapshot hook without enabling other production features.
  const prior=process.env.DYNAMIC_CHALLENGES_ENABLED;
  process.env.DYNAMIC_CHALLENGES_ENABLED='1';
  t.after(()=>{if(prior===undefined)delete process.env.DYNAMIC_CHALLENGES_ENABLED;else process.env.DYNAMIC_CHALLENGES_ENABLED=prior;});
  return {db,s,c,row,at:()=>at,advance:n=>at+=n,snap:(players)=>s.snapshot(players,at),daily:()=>c.status(A).challenges[0],weekly:()=>c.status(A).challenges[1]};
}
test('Brisbane midnight and Monday boundaries define stable daily/weekly rotations',()=>{
  const before=periods(Date.parse('2026-11-08T23:59:59+10:00'));
  const after=periods(Date.parse('2026-11-09T00:00:00+10:00'));
  assert.equal(before[0].end,after[0].start);
  assert.equal(before[1].end,after[1].start);
  assert.notEqual(before[0].definition.id,after[0].definition.id);
  assert.equal(new Date(after[1].start).toISOString(),'2026-11-08T14:00:00.000Z');
});
test('default-off store rejects enrollment and collects no evidence',t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  const c=createDynamicChallengeStore(db,{enabled:()=>false});
  assert.throws(()=>c.participate(A,true),{status:503});
  c.observe([{steam_id:A,id:'life',species:'rex'}],Date.now());
  assert.deepEqual(c.status(A),{enabled:false});
  assert.equal(db.prepare('SELECT count(*) n FROM dc_cursor').get().n,0);
});
test('accepted snapshots count distinct species only after enrollment; retries do not add progress',t=>{
  const x=setup(t);x.snap([x.row()]);assert.equal(x.weekly().progress,0);
  x.c.participate(A,true);x.advance(MIN);x.snap([x.row()]);
  assert.deepEqual(x.snap([x.row()]),{duplicate:true});
  x.advance(MIN);x.snap([x.row('tenonto')]);x.advance(MIN);x.snap([x.row('stego')]);
  assert.equal(x.weekly().progress,3);assert.equal(x.weekly().completed,true);
  assert.equal(x.c.status(B).challenges[1].progress,0);
  assert.equal(x.c.status(A).rewardsEnabled,false);
});
test('90 minutes requires one connected observed life, not accumulated lives',t=>{
  const x=setup(t);assert.equal(x.daily().id,'survival-90');x.c.participate(A,true);
  x.advance(MIN);x.snap([x.row()]);
  for(let i=0;i<9;i++){x.advance(10*MIN);x.snap([x.row()]);}
  assert.equal(x.daily().progress,5400);assert.equal(x.daily().completed,true);
  x.advance(MIN);x.snap([x.row('tenonto')]);
  assert.equal(x.daily().progress,5400); // Previous valid completion remains.
});
test('species aliases cannot inflate variety and unknown labels do not qualify',t=>{
  const x=setup(t);x.c.participate(A,true);
  for(const species of ['rex','tyrannosaurus','tyrannosaurusrex','not-a-dinosaur']){x.advance(MIN);x.snap([x.row(species)]);}
  assert.equal(x.weekly().progress,1);
});
test('period rollover cannot import prior growth or species; missing days impose no debt',t=>{
  const x=setup(t,'2026-11-06T23:59:00+10:00');x.c.participate(A,true);
  x.advance(MIN/2);x.snap([x.row('tenonto',0.5)]);
  x.advance(4*86400000);x.snap([x.row('tenonto',1)]);
  assert.equal(x.daily().id,'herbivore-adult');assert.equal(x.daily().progress,0);
  assert.equal(x.weekly().progress,1);
  assert.equal('streak' in x.c.status(A),false);
});
test('stale and pre-enrollment samples cannot add challenge evidence',t=>{
  const x=setup(t);x.c.participate(A,true);x.snap([x.row()]);assert.equal(x.weekly().progress,0);
  x.advance(MIN);x.snap([x.row()]);
  assert.deepEqual(x.s.snapshot([x.row('tenonto')],x.at()-1),{duplicate:true});
  assert.equal(x.weekly().progress,1);
  assert.throws(()=>x.c.participate(A,'true'),/Explicit/);
  assert.throws(()=>x.c.status('bad'),/Steam/);
});
test('disappearance, growth reset and gaps cannot join survival segments',t=>{
  for(const reset of ['missing','growth','gap']) {
    const x=setup(t);x.c.participate(A,true);x.advance(MIN);x.snap([x.row()]);
    x.advance(10*MIN);x.snap([x.row()]);
    if(reset==='missing'){x.advance(MIN);x.snap([]);x.advance(MIN);x.snap([x.row()]);}
    if(reset==='growth'){x.advance(MIN);x.snap([x.row('rex',0.1)]);}
    if(reset==='gap'){x.advance(16*MIN);x.snap([x.row()]);}
    x.advance(10*MIN);x.snap([x.row('rex',reset==='growth'?0.1:0.5)]);
    assert.equal(x.daily().progress,600,reset);
  }
});
test('invalid species breaks continuity even when Legacy keeps the old life identity',t=>{
  const x=setup(t);x.c.participate(A,true);x.advance(MIN);x.snap([x.row()]);
  x.advance(10*MIN);x.snap([x.row()]);
  const before=x.db.prepare('SELECT id FROM vl_lives WHERE ended_at IS NULL').get().id;
  x.advance(MIN);x.snap([x.row('')]);x.advance(MIN);x.snap([x.row()]);
  assert.equal(x.db.prepare('SELECT id FROM vl_lives WHERE ended_at IS NULL').get().id,before);
  x.advance(10*MIN);x.snap([x.row()]);assert.equal(x.daily().progress,600);
});
test('observed juvenile then adult herbivore qualifies only in one life and period',t=>{
  const x=setup(t,'2026-11-06T00:00:00+10:00');assert.equal(x.daily().id,'herbivore-adult');
  x.c.participate(A,true);x.advance(MIN);x.snap([x.row('tenonto',1)]);assert.equal(x.daily().progress,0);
  x.advance(MIN);x.snap([x.row('tenonto',0.5)]);x.advance(MIN);x.snap([x.row('tenonto',1)]);
  assert.equal(x.daily().progress,1);
});
test('carnivore adulthood and invalid growth do not qualify',t=>{
  const x=setup(t,'2026-11-06T00:00:00+10:00');x.c.participate(A,true);
  for(const p of [x.row('rex',0.5),x.row('rex',1),x.row('tenonto',null),x.row('tenonto',1)]) {x.advance(MIN);x.snap([p]);}
  assert.equal(x.daily().progress,0);
});
test('opt-out removes private progress and rejoining never imports it',t=>{
  const x=setup(t);x.c.participate(A,true);x.advance(MIN);x.snap([x.row()]);
  assert.equal(x.weekly().progress,1);x.c.participate(A,false);
  for(const table of ['dc_evidence','dc_cursor','dc_participants'])assert.equal(x.db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
  x.c.participate(A,true);assert.equal(x.weekly().progress,0);
  x.advance(MIN);x.snap([x.row('tenonto')]);assert.equal(x.weekly().progress,1);
  assert.equal(x.daily().progress,0);
});
test('evidence failure rolls back snapshot and can be retried exactly once',t=>{
  const x=setup(t);x.c.participate(A,true);x.advance(MIN);
  x.db.exec("CREATE TRIGGER dc_test_failure BEFORE INSERT ON dc_evidence BEGIN SELECT RAISE(ABORT,'evidence unavailable'); END");
  assert.throws(()=>x.snap([x.row()]),/evidence unavailable/);
  assert.equal(x.db.prepare('SELECT count(*) n FROM vl_lives').get().n,0);
  assert.equal(x.weekly().progress,0);
  x.db.exec('DROP TRIGGER dc_test_failure');x.snap([x.row()]);assert.equal(x.weekly().progress,1);
});
test('store reopening preserves progress without changing unrelated wallet data',t=>{
  const x=setup(t);x.db.exec('CREATE TABLE economy_wallets(steam_id TEXT,coins INTEGER); INSERT INTO economy_wallets VALUES (\'untouched\',123)');
  x.c.participate(A,true);x.advance(MIN);x.snap([x.row()]);
  const reopened=createDynamicChallengeStore(x.db,{now:x.at,enabled:()=>true});
  assert.equal(reopened.status(A).challenges[1].progress,1);
  assert.deepEqual({...x.db.prepare('SELECT * FROM economy_wallets').get()},{steam_id:'untouched',coins:123});
  const view=JSON.stringify(reopened.status(A));assert.equal(view.includes(A),false);assert.equal(view.includes('location'),false);
});
