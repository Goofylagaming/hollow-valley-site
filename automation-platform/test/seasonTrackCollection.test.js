"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const {createSeasonTrackStore,describe,collectionReady}=require('../src/services/seasonTrackStore');
const {createAchievementSourceTimeStore}=require('../src/services/achievementSourceTime');
const A='76561198000000401',B='76561198000000402',C='76561198000000403',START=Date.parse('2027-01-01T00:00:00Z'),iso=x=>new Date(x).toISOString();
function fixture(t,{file=':memory:',achievement=false}={}) {
 const db=new DatabaseSync(file);db.exec(`PRAGMA busy_timeout=5000;
 CREATE TABLE progression_xp_ledger(id TEXT PRIMARY KEY,steam_id TEXT,amount INTEGER,source TEXT,reference_type TEXT,created_at TEXT);
 CREATE TABLE progression_xp_source_times(ledger_id TEXT PRIMARY KEY,source_at INTEGER,basis TEXT);
 CREATE TABLE progression_achievements(steam_id TEXT,achievement_id TEXT,metadata_json TEXT,unlocked_at TEXT,PRIMARY KEY(steam_id,achievement_id));
 CREATE TABLE economy_quest_achievements(steam_id TEXT,quest_id TEXT,period_key TEXT,achieved_at TEXT);
 CREATE TABLE wallet_fixture(balance INTEGER);INSERT INTO wallet_fixture VALUES(1234);`);
 t.after(()=>db.close());let clock=START-1000,paused=false;
 const store=createSeasonTrackStore(db,{now:()=>clock,writable:()=>{if(paused)throw new Error('Read only');}}),sources=createAchievementSourceTimeStore(db,{now:()=>clock});
 const def={id:'synthetic-collection-season',title:'Synthetic collection season',startsAt:iso(START),endsAt:iso(START+86400000),settlesAt:iso(START+2*86400000),retainUntil:iso(START+30*86400000),free:true,sources:[{source:'quest',policy:'achievement-time'}],tiers:[{xp:10,title:'Synthetic milestone'}],...(achievement?{achievementPoints:{policy:'qualifying-source-time',awards:[{id:'quest-1',xp:25}]}}:{})},digest=describe(def).digest;
 store.stage(def,{reviewer:A,digest});store.changeState(def.id,{action:'publish',reviewer:A,digest,expectedRevision:1});clock=START;
 const grant=(id,who=A,{time=clock,receivedAt=clock,known=true}={})=>{db.prepare("INSERT INTO progression_xp_ledger VALUES(?,?,10,'quest','quest',?)").run(id,who,iso(receivedAt));if(known)db.prepare("INSERT INTO progression_xp_source_times VALUES(?,?,'quest-achievement')").run(id,time);};
 const enroll=(who=A)=>store.enroll(def.id,who),xp=(who=A)=>store.progress(def.id,who).xp;
 return {db,store,def,digest,enroll,grant,xp,clock:value=>{clock=value;},pause:()=>{paused=true;},sources};
}
test('bounded queue visits participants fairly across restarts, wraps and preserves read-only projections and balances',t=>{
 const f=fixture(t);for(const actor of [A,B,C])f.enroll(actor);for(let i=0;i<5;i++)f.grant('many-'+i);f.grant('one-b',B);f.grant('one-c',C);
 assert.equal(collectionReady(f.db),true);const changes=f.db.prepare('SELECT total_changes() n').get().n;assert.equal(f.xp(),0);assert.equal(f.db.prepare('SELECT total_changes() n').get().n,changes);
 let result=f.store.collect({limit:1,evidenceLimit:2});assert.equal(result.scanned,2);assert.equal(result.more,true);assert.equal(f.xp(),20);
 const reopened=createSeasonTrackStore(f.db,{initialize:false,now:()=>START});reopened.collect({limit:1,evidenceLimit:2});assert.equal(f.xp(B),10);reopened.collect({limit:1,evidenceLimit:2});assert.equal(f.xp(C),10);
 reopened.collect({limit:1,evidenceLimit:2});assert.equal(f.xp(),40);
 f.store.collect({limit:10,evidenceLimit:2});assert.equal(f.xp(),50);assert.equal(f.db.prepare('SELECT count(*) n FROM progression_season_evidence').get().n,7);
 assert.equal(f.db.prepare('SELECT balance FROM wallet_fixture').get().balance,1234);assert.equal(f.db.prepare('SELECT count(*) n FROM progression_xp_ledger').get().n,7);
 for(const options of [{limit:0},{limit:26},{limit:1.5},{evidenceLimit:0},{evidenceLimit:1001},{limit:25,evidenceLimit:101}])assert.throws(()=>f.store.collect(options),/batch size/);
});
test('source errors roll back only that participant and do not starve the queue; checkpoint failure rolls back the entire batch',t=>{
 const f=fixture(t);f.enroll();f.enroll(B);f.grant('a');f.grant('b',B);
 f.db.exec(`CREATE TRIGGER reject_a BEFORE INSERT ON progression_season_evidence WHEN NEW.steam_id='${A}' BEGIN SELECT RAISE(ABORT,'private source failure'); END`);
 const result=f.store.collect({limit:2});assert.equal(result.unavailable,1);assert.equal(result.accepted,1);assert.equal(f.xp(),0);assert.equal(f.xp(B),10);assert.doesNotMatch(JSON.stringify(result),/76561198|private/);
 f.db.exec('DROP TRIGGER reject_a');assert.equal(f.store.collect({limit:2}).accepted,1);assert.equal(f.xp(),10);
 f.grant('a-later');f.grant('b-later',B);const cursor=f.db.prepare('SELECT after_position FROM progression_season_collection_cursor').get().after_position;
 f.db.exec("CREATE TRIGGER reject_checkpoint BEFORE UPDATE ON progression_season_collection_cursor BEGIN SELECT RAISE(ABORT,'checkpoint unavailable'); END");
 assert.throws(()=>f.store.collect({limit:2}),/checkpoint unavailable/);assert.equal(f.xp(),10);assert.equal(f.xp(B),10);assert.equal(f.db.prepare('SELECT after_position FROM progression_season_collection_cursor').get().after_position,cursor);
 f.db.exec('DROP TRIGGER reject_checkpoint');assert.equal(f.store.collect({limit:2}).accepted,2);
});
test('automatic achievement copies share source and consent rules, revalidate withdrawals and never issue permanent XP',t=>{
 const f=fixture(t,{achievement:true});f.enroll();f.db.prepare('INSERT INTO economy_quest_achievements VALUES(?,?,?,?)').run(A,'synthetic','period',iso(START));
 f.db.exec('BEGIN IMMEDIATE');f.db.prepare('INSERT INTO progression_achievements VALUES(?,?,?,?)').run(A,'quest-1',JSON.stringify({type:'quests',threshold:1,value:1}),iso(START));f.sources.recordNewAward(A,'quest-1');f.db.exec('COMMIT');
 assert.equal(f.store.collect().achievementAccepted,1);assert.equal(f.xp(),25);assert.equal(f.store.collect().achievementAccepted,0);
 f.db.exec('DELETE FROM economy_quest_achievements');assert.equal(f.xp(),0);assert.equal(f.db.prepare('SELECT count(*) n FROM progression_xp_ledger').get().n,0);
});
test('deletion removes queue identities; same-clock re-enrollment cannot recover erased XP or old achievements',t=>{
 const f=fixture(t);f.enroll();f.grant('before-leave');f.store.collect();const first=f.db.prepare('SELECT position FROM progression_season_collection_queue').get().position;
 f.store.erase(f.def.id,A);assert.equal(f.db.prepare('SELECT count(*) n FROM progression_season_collection_queue').get().n,0);
 f.enroll();assert.ok(f.db.prepare('SELECT position FROM progression_season_collection_queue').get().position>first);f.store.collect();assert.equal(f.xp(),0);
 f.grant('after-rejoin');f.store.collect();assert.equal(f.xp(),10);
});
test('expired history is never collected; independent cleanup deletes queue rows and paused stores do no work',t=>{
 const f=fixture(t);f.enroll();f.grant('valid');f.clock(Date.parse(f.def.retainUntil));assert.equal(f.store.collect().visited,0);assert.equal(f.db.prepare('SELECT count(*) n FROM progression_season_evidence').get().n,0);
 f.store.maintain();assert.equal(f.db.prepare('SELECT count(*) n FROM progression_season_collection_queue').get().n,0);
 f.pause();const before=f.db.prepare('SELECT total_changes() n').get().n;assert.throws(()=>f.store.collect(),/Read only/);assert.equal(f.db.prepare('SELECT total_changes() n').get().n,before);
});
test('delayed valid receipts remain collectable after closing; late and unknown clocks are not upgraded',t=>{
 const f=fixture(t);f.enroll();f.clock(START+3*86400000);f.store.changeState(f.def.id,{action:'close',reviewer:A,digest:f.digest,expectedRevision:2});
 f.grant('delayed-valid',A,{time:START+1000,receivedAt:START+86400000});f.grant('received-too-late',A,{time:START+1000});f.grant('unknown',A,{known:false});
 assert.equal(f.store.collect().accepted,1);assert.equal(f.xp(),10);
});
test('runtime collection never installs a missing queue or repairs replaced hooks; explicit initialization migrates legacy enrollments',t=>{
 const f=fixture(t);f.enroll();f.db.exec('DROP TRIGGER progression_season_collection_join;DROP TRIGGER progression_season_collection_leave;DROP TABLE progression_season_collection_queue;DROP TABLE progression_season_collection_cursor');
 const before=f.db.prepare('SELECT total_changes() n').get().n;assert.throws(()=>f.store.collect(),/Prepare.*queue/);assert.equal(f.db.prepare('SELECT total_changes() n').get().n,before);assert.equal(f.xp(),0);
 createSeasonTrackStore(f.db);assert.equal(collectionReady(f.db),true);assert.equal(f.db.prepare('SELECT count(*) n FROM progression_season_collection_queue').get().n,1);
 f.db.exec('DROP TRIGGER progression_season_collection_leave;CREATE TRIGGER progression_season_collection_leave AFTER DELETE ON progression_season_enrollments BEGIN SELECT 1;END');
 assert.equal(collectionReady(f.db),false);assert.throws(()=>f.store.collect(),/Prepare.*queue/);
  f.store.erase(f.def.id,A);assert.equal(f.db.prepare('SELECT count(*) n FROM progression_season_collection_queue').get().n,0,'privacy deletion does not depend on a working queue hook');
});
