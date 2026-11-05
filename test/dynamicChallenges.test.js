"use strict";
const test=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {createLegacyStore}=require('../automation-platform/src/services/valleyLegacyStore');
const {createDynamicChallengeStore,periods}=require('../automation-platform/src/services/dynamicChallengeStore');
const {randomUUID}=require('node:crypto');
const A='76561198000000001', B='76561198000000002', MIN=60000;
function setup(t,date='2026-11-05T00:00:00+10:00') {
  let at=Date.parse(date);
  const db=new DatabaseSync(':memory:');
  const s=createLegacyStore(db,{now:()=>at});
  const c=createDynamicChallengeStore(db,{now:()=>at,enabled:()=>true});
  t.after(()=>db.close());
  c.participate=(id,selected)=>c.change(id,{selected,expectedRevision:c.status(id).revision||0,requestKey:randomUUID()});
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
  assert.throws(()=>c.change(A,{selected:true,expectedRevision:0,requestKey:randomUUID()}),{status:503});
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
  const view=JSON.stringify(reopened.status(A));assert.equal(view.includes(A),false);assert.equal(view.includes('"x":'),false);assert.equal(view.includes('"y":'),false);
});
test('consent revisions reject stale changes while exact retries recover current state',t=>{
  const x=setup(t);
  const enroll={selected:true,expectedRevision:0,requestKey:randomUUID()};
  const a=x.c.change(A,enroll);assert.equal(a.revision,1);assert.equal(a.duplicate,false);
  const joined=x.db.prepare('SELECT joined_at FROM dc_participants').get().joined_at;
  x.advance(MIN);assert.equal(x.c.change(A,enroll).duplicate,true);
  assert.equal(x.db.prepare('SELECT joined_at FROM dc_participants').get().joined_at,joined);
  assert.throws(()=>x.c.change(A,{...enroll,selected:false}),{status:409});
  assert.throws(()=>x.c.change(A,{...enroll,requestKey:randomUUID()}),{status:409});
  x.c.change(A,{selected:false,expectedRevision:1,requestKey:randomUUID()});
  const retry=x.c.change(A,enroll);assert.equal(retry.participating,false);assert.equal(retry.revision,2);assert.equal(retry.duplicate,true);
  assert.equal(x.db.prepare('SELECT count(*) n FROM dc_requests').get().n,2);
  assert.throws(()=>x.c.change(A,{selected:true,expectedRevision:1,requestKey:randomUUID()}),{status:409});
});
test('failed consent receipt rolls back enrollment, deletion and revision',t=>{
  const x=setup(t);x.c.participate(A,true);x.advance(MIN);x.snap([x.row()]);
  x.db.exec("CREATE TRIGGER fail_consent BEFORE INSERT ON dc_requests BEGIN SELECT RAISE(ABORT,'receipt unavailable'); END");
  const choice={selected:false,expectedRevision:1,requestKey:randomUUID()};
  assert.throws(()=>x.c.change(A,choice),/receipt unavailable/);
  assert.equal(x.c.status(A).participating,true);assert.equal(x.c.status(A).revision,1);assert.equal(x.weekly().progress,1);
  x.db.exec('DROP TRIGGER fail_consent');assert.equal(x.c.change(A,choice).revision,2);
  assert.equal(x.weekly().progress,0);
});
test('rate limits do not prevent a participant opting out; invalid choices never write receipts',t=>{
  const x=setup(t);x.c.participate(A,true);
  for(let revision=1;revision<20;revision++)x.c.change(A,{selected:true,expectedRevision:revision,requestKey:randomUUID()});
  assert.throws(()=>x.c.change(A,{selected:true,expectedRevision:20,requestKey:randomUUID()}),{status:429});
  assert.equal(x.c.change(A,{selected:false,expectedRevision:20,requestKey:randomUUID()}).participating,false);
  assert.throws(()=>x.c.change(A,{selected:false,expectedRevision:21,requestKey:randomUUID()}),{status:429});
  for(const expectedRevision of [null,-1,'21',1.5,Number.MAX_SAFE_INTEGER+1])
    assert.throws(()=>x.c.change(A,{selected:false,expectedRevision,requestKey:randomUUID()}),{status:400});
  assert.throws(()=>x.c.change(A,{selected:true,expectedRevision:21,requestKey:'short'}),{status:400});
  assert.equal(x.db.prepare('SELECT count(*) n FROM dc_requests').get().n,21);
  x.advance(MIN+1);assert.equal(x.c.change(A,{selected:true,expectedRevision:21,requestKey:randomUUID()}).revision,22);
});
test('disabling tracking breaks survival continuity while preserving consent and earlier best progress',t=>{
  const x=setup(t);x.c.participate(A,true);x.advance(MIN);x.snap([x.row()]);
  x.advance(10*MIN);x.snap([x.row()]);assert.equal(x.daily().progress,600);
  process.env.DYNAMIC_CHALLENGES_ENABLED='0';x.s.challenges.prune();
  assert.equal(x.db.prepare('SELECT count(*) n FROM dc_cursor').get().n,0);
  assert.equal(x.c.status(A).participating,true);assert.equal(x.c.status(A).revision,1);
  x.advance(MIN);x.snap([x.row()]); // Legacy still observes; challenges do not.
  process.env.DYNAMIC_CHALLENGES_ENABLED='1';x.advance(MIN);x.snap([x.row()]);
  x.advance(10*MIN);x.snap([x.row()]);assert.equal(x.daily().progress,600);
  assert.equal(x.weekly().progress,1);
});
test('juvenile evidence cannot bridge a disabled tracking interval',t=>{
  const x=setup(t,'2026-11-06T00:00:00+10:00');x.c.participate(A,true);x.advance(MIN);x.snap([x.row('tenonto',0.5)]);
  process.env.DYNAMIC_CHALLENGES_ENABLED='0';x.advance(MIN);x.snap([x.row('tenonto',0.75)]);
  process.env.DYNAMIC_CHALLENGES_ENABLED='1';x.advance(MIN);x.snap([x.row('tenonto',1)]);
  assert.equal(x.daily().progress,0);assert.equal(x.c.status(A).participating,true);
});
test('delayed observations from a disabled interval cannot backfill after restart',t=>{
  const x=setup(t);x.c.participate(A,true);x.advance(MIN);x.snap([x.row()]);
  process.env.DYNAMIC_CHALLENGES_ENABLED='0';x.s.challenges.prune();x.advance(MIN);
  const disabledAt=x.at();x.advance(MIN);
  process.env.DYNAMIC_CHALLENGES_ENABLED='1';x.s.challenges.prune();
  x.s.snapshot([x.row('tenonto')],disabledAt);
  assert.equal(x.weekly().progress,1);assert.equal(x.db.prepare('SELECT count(*) n FROM dc_cursor').get().n,0);
  x.advance(MIN);x.snap([x.row('tenonto')]);assert.equal(x.weekly().progress,2);
});
test('a disabled restart breaks cursors even without any intervening snapshot',t=>{
  const x=setup(t);x.c.participate(A,true);x.advance(MIN);x.snap([x.row()]);x.advance(10*MIN);x.snap([x.row()]);
  createDynamicChallengeStore(x.db,{now:x.at,enabled:()=>false});
  assert.equal(x.db.prepare('SELECT active FROM dc_runtime').get().active,0);
  createDynamicChallengeStore(x.db,{now:x.at,enabled:()=>true});
  x.advance(MIN);x.snap([x.row()]);x.advance(10*MIN);x.snap([x.row()]);
  assert.equal(x.daily().progress,600);assert.equal(x.c.status(A).revision,1);
});
test('independent retention removes expired evidence during an outage, keeping consent and replay protection',t=>{
  const x=setup(t);x.c.participate(A,true);x.advance(MIN);x.snap([x.row()]);
  const before=x.db.prepare('SELECT count(*) n FROM dc_evidence').get().n;assert.ok(before>0);
  x.advance(36*86400000);const removed=x.c.prune();assert.equal(removed.evidence,before);assert.equal(removed.cursors,1);
  assert.equal(x.db.prepare('SELECT count(*) n FROM dc_evidence').get().n,0);
  assert.equal(removed.observations,1);
  assert.equal(x.db.prepare('SELECT count(*) n FROM dc_observations').get().n,0);
  assert.equal(x.c.status(A).participating,true);assert.equal(x.c.status(A).revision,1);
  assert.equal(x.db.prepare('SELECT count(*) n FROM dc_requests').get().n,1);
});
test('maintenance rollback retains consistent evidence, runtime and cursor after a storage error',t=>{
  const x=setup(t);x.c.participate(A,true);x.advance(MIN);x.snap([x.row()]);
  x.advance(36*86400000);process.env.DYNAMIC_CHALLENGES_ENABLED='0';
  x.db.exec("CREATE TRIGGER fail_prune BEFORE DELETE ON dc_evidence BEGIN SELECT RAISE(ABORT,'cleanup unavailable'); END");
  assert.throws(()=>x.s.challenges.prune(),/cleanup unavailable/);
  assert.equal(x.db.prepare('SELECT count(*) n FROM dc_cursor').get().n,1);
  assert.equal(x.db.prepare('SELECT active FROM dc_runtime').get().active,1);
  x.db.exec('DROP TRIGGER fail_prune');x.s.challenges.prune();
  assert.equal(x.db.prepare('SELECT count(*) n FROM dc_cursor').get().n,0);
  assert.equal(x.db.prepare('SELECT count(*) n FROM dc_evidence').get().n,0);
  assert.equal(x.db.prepare('SELECT active FROM dc_runtime').get().active,0);
});
function survivalRun(x,count=9){
  x.c.participate(A,true);x.advance(MIN);x.snap([x.row()]);const first=x.at();
  for(let n=0;n<count;n++){x.advance(10*MIN);x.snap([x.row()]);}
  return first;
}
test('late deaths recompute connected survival instead of preserving a false 90-minute completion',t=>{
  const x=setup(t),first=survivalRun(x);assert.equal(x.daily().completed,true);
  const life=x.db.prepare('SELECT id FROM vl_lives WHERE ended_at IS NULL').get().id;
  x.s.ingest({id:'late-middle',type:'combat_death',steamId:A,at:first+45*MIN});
  assert.equal(x.daily().progress,2400);assert.equal(x.daily().completed,false);
  assert.equal(x.db.prepare('SELECT id FROM vl_lives WHERE ended_at IS NULL').get().id,life);
  assert.equal(x.db.prepare('SELECT count(*) n FROM dc_cursor').get().n,0);
  x.advance(10*MIN);x.snap([x.row()]);
  for(let n=0;n<5;n++){x.advance(10*MIN);x.snap([x.row()]);}
  assert.equal(x.daily().progress,3000); // New observations cannot extend the old best run.
});
test('late death preserves a valid 90-minute completion achieved before the death',t=>{
  const x=setup(t),first=survivalRun(x,11);
  x.s.ingest({id:'late-after-completion',type:'combat_death',steamId:A,at:first+105*MIN});
  assert.equal(x.daily().progress,5400);assert.equal(x.daily().completed,true);
});
test('out-of-order deaths and exact duplicates recompute from the same retained observations',t=>{
  const x=setup(t),first=survivalRun(x);
  x.s.ingest({id:'later-death',type:'combat_death',steamId:A,at:first+75*MIN});assert.equal(x.daily().progress,4200);
  const earlier={id:'earlier-death',type:'combat_death',steamId:A,at:first+25*MIN};
  x.s.ingest(earlier);assert.equal(x.daily().progress,2400);
  assert.deepEqual(x.s.ingest(earlier),{duplicate:true});assert.equal(x.daily().progress,2400);
  assert.equal(x.db.prepare('SELECT count(*) n FROM dc_observations').get().n,10);
});
test('retained observations support late correction after reopening the Legacy store',t=>{
  const x=setup(t),first=survivalRun(x);
  const reopened=createLegacyStore(x.db,{now:x.at});
  reopened.ingest({id:'after-restart',type:'combat_death',steamId:A,at:first+45*MIN});
  assert.equal(reopened.challenges.status(A).challenges[0].progress,2400);
  assert.equal(x.db.prepare('SELECT count(*) n FROM dc_observations').get().n,10);
});
test('a death at an observation timestamp cannot count that point as an alive endpoint',t=>{
  const x=setup(t),first=survivalRun(x);
  x.s.ingest({id:'at-sample',type:'combat_death',steamId:A,at:first+50*MIN});
  assert.equal(x.daily().progress,2400);
});
test('late deaths prevent growth across death while retaining adulthood already observed before death',t=>{
  for(const afterAdult of [false,true]){
    const x=setup(t,'2026-11-06T00:00:00+10:00');x.c.participate(A,true);
    x.advance(MIN);x.snap([x.row('tenonto',0.5)]);const first=x.at();
    x.advance(10*MIN);x.snap([x.row('tenonto',1)]);x.advance(10*MIN);x.snap([x.row('tenonto',1)]);
    assert.equal(x.daily().completed,true);
    x.s.ingest({id:'growth-death',type:'combat_death',steamId:A,at:first+(afterAdult?15:5)*MIN});
    assert.equal(x.daily().completed,afterAdult);
  }
});
test('known death evidence breaks future observation continuity even without a Legacy life link',t=>{
  const x=setup(t);x.c.participate(A,true);x.advance(MIN);x.snap([x.row()]);
  x.advance(10*MIN);x.snap([x.row()]);const previous=x.at();x.advance(5*MIN);
  x.s.ingest({id:'unmatched-death',type:'combat_death',steamId:A,at:previous+3*MIN});
  x.snap([x.row()]);x.advance(10*MIN);x.snap([x.row()]);assert.equal(x.daily().progress,600);
});
test('failed death reconciliation rolls back the source event and all progress changes',t=>{
  const x=setup(t),first=survivalRun(x);
  x.db.exec("CREATE TRIGGER fail_death BEFORE DELETE ON dc_evidence BEGIN SELECT RAISE(ABORT,'reconciliation unavailable'); END");
  const event={id:'retry-death',type:'combat_death',steamId:A,at:first+45*MIN};
  assert.throws(()=>x.s.ingest(event),/reconciliation unavailable/);
  assert.equal(x.db.prepare('SELECT count(*) n FROM vl_events WHERE id=?').get(event.id).n,0);
  assert.equal(x.daily().progress,5400);
  x.db.exec('DROP TRIGGER fail_death');x.s.ingest(event);assert.equal(x.daily().progress,2400);
});
test('opt-out erases challenge observations and late deaths cannot recreate deleted participation',t=>{
  const x=setup(t),first=survivalRun(x);x.c.participate(A,false);
  assert.equal(x.db.prepare('SELECT count(*) n FROM dc_observations').get().n,0);
  x.s.ingest({id:'after-optout',type:'combat_death',steamId:A,at:first+45*MIN});
  assert.equal(x.c.status(A).participating,false);assert.equal(x.daily().progress,0);
  assert.equal(x.db.prepare('SELECT count(*) n FROM dc_observations').get().n,0);
});
test('pre-journal aggregates remain stored but cannot qualify as reconciled survival evidence',t=>{
  const x=setup(t);x.c.participate(A,true);
  x.db.prepare('INSERT INTO dc_evidence VALUES (?,?,?,?,?,?,?)').run(A,'daily',x.daily().startsAt,'survival-90','older-unreconciled-segment',5400,0);
  assert.equal(x.daily().progress,0);assert.equal(x.daily().completed,false);
  assert.equal(x.db.prepare("SELECT amount FROM dc_evidence WHERE subject='older-unreconciled-segment'").get().amount,5400);
});
test('a late death only corrects the affected participant and still works while tracking is disabled',t=>{
  const x=setup(t);x.c.participate(A,true);x.c.participate(B,true);x.advance(MIN);const first=x.at();
  for(let n=0;n<=9;n++){
    if(n)x.advance(10*MIN);
    x.snap([x.row(),{...x.row(),steamId:B}]);
  }
  process.env.DYNAMIC_CHALLENGES_ENABLED='0';x.s.challenges.prune();
  x.s.ingest({id:'only-a',type:'combat_death',steamId:A,at:first+45*MIN});
  assert.equal(x.daily().progress,2400);assert.equal(x.c.status(B).challenges[0].progress,5400);
  assert.equal(x.weekly().progress,1);assert.equal(x.c.status(B).challenges[1].progress,1);
});
test('trusted combat import retries failed challenge correction without advancing its source checkpoint',()=>{
  const {execFileSync}=require('node:child_process');
  const code=String.raw`
    const assert=require('node:assert/strict');
    let clock=Date.parse('2026-11-05T00:00:00+10:00');Date.now=()=>clock;
    const legacy=require('./automation-platform/src/services/valleyLegacyService'),s=legacy.get(),db=s.db;
    const id='76561198000000001';
    s.challenges.change(id,{selected:true,expectedRevision:0,requestKey:'trusted-import-enroll'});
    clock+=60000;const first=clock;
    for(let n=0;n<=9;n++){if(n)clock+=600000;s.snapshot([{steamId:id,species:'rex',growth:0.5}],clock);}
    db.exec('CREATE TABLE combat_events(id TEXT PRIMARY KEY,occurred_at TEXT,killer_steam_id TEXT,killer_name TEXT,victim_steam_id TEXT,victim_name TEXT)');
    db.prepare('INSERT INTO combat_events VALUES (?,?,?,?,?,?)').run('trusted-late',new Date(first+45*60000).toISOString(),'76561198000000002','Other',id,'Survivor');
    db.exec("CREATE TRIGGER fail_import BEFORE DELETE ON dc_evidence BEGIN SELECT RAISE(ABORT,'import correction unavailable'); END");
    assert.throws(()=>legacy.reconcile(),/import correction unavailable/);
    assert.equal(db.prepare("SELECT count(*) n FROM vl_imports WHERE source='combat_events'").get().n,0);
    assert.equal(s.challenges.status(id).challenges[0].progress,5400);
    db.exec('DROP TRIGGER fail_import');legacy.reconcile();legacy.reconcile();
    assert.equal(s.challenges.status(id).challenges[0].progress,2400);
    assert.equal(db.prepare("SELECT count(*) n FROM vl_events WHERE id='combat:trusted-late:death'").get().n,1);
    assert.equal(db.prepare("SELECT count(*) n FROM vl_imports WHERE source='combat_events'").get().n,1);
    db.close();
  `;
  execFileSync(process.execPath,['-e',code],{cwd:require('node:path').join(__dirname,'..'),env:{...process.env,AUTOMATION_DB_PATH:':memory:',VALLEY_LEGACY_ENABLED:'1',DYNAMIC_CHALLENGES_ENABLED:'1'},stdio:'pipe'});
});
