"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hv-prime-source-'));
process.env.AUTOMATION_DB_PATH=path.join(directory,'synthetic.sqlite');
const progression=require('../src/services/progressionService'),economy=require('../src/services/economyStore'),tracker=require('../src/services/primeTrackerService');
const {createAchievementSourceTimeStore}=require('../src/services/achievementSourceTime'),{createSeasonTrackStore,describe}=require('../src/services/seasonTrackStore');
const sources=createAchievementSourceTimeStore(economy.db),A='76561198000000401',B='76561198000000402',C='76561198000000403',D='76561198000000404',E='76561198000000405';
const START=Date.now()-7200000,iso=value=>new Date(value).toISOString(),env={PRIME_TRACKER_ENABLED:'true'};
const sample=(id,prime,at,species='Rex')=>tracker.recordSnapshot([{steamId:id,isPrime:prime,growth:1,species}],iso(at),{env});
const badge=id=>progression.getProfile(id,{sync:true}).achievements.find(item=>item.id==='prime-observed');
test.after(()=>{tracker._test.db.close();economy.db.close();fs.rmSync(directory,{recursive:true,force:true});});
test('new transition and first-seen Prime observations retain source dates without claiming natural attainment or adding XP/coins',()=>{
 let clock=START-1000;const seasons=createSeasonTrackStore(economy.db,{now:()=>clock});
 const def={id:'synthetic-prime-season',title:'Synthetic observed Prime',startsAt:iso(START),endsAt:iso(START+86400000),settlesAt:iso(START+2*86400000),retainUntil:iso(START+30*86400000),free:true,sources:[],tiers:[{xp:60,title:'Synthetic milestone'}],achievementPoints:{policy:'qualifying-source-time',awards:[{id:'prime-observed',xp:60}]}},digest=describe(def).digest;
 seasons.stage(def,{reviewer:A,digest});seasons.changeState(def.id,{reviewer:A,digest,action:'publish',expectedRevision:1});clock=START;seasons.enroll(def.id,A);
 sample(A,false,START);assert.equal(badge(A),undefined);sample(A,true,START+60000);assert.equal(badge(A).title,'Prime Survivor');
 const first=sources.read(A,'prime-observed');assert.equal(first.sourceAt,START+60000);assert.equal(first.basis,'first-prime-observation');
 clock=Date.now()+1000;seasons.reconcile(def.id,A);assert.equal(seasons.progress(def.id,A).xp,60);assert.equal(economy.getWallet(A).balance,0);assert.equal(progression.getProfile(A,{sync:false}).xp,0);
 sample(A,false,START+120000,'Gallimimus');assert.equal(sources.read(A,'prime-observed').sourceAt,first.sourceAt);
 sample(B,true,START+180000);assert.equal(badge(B).title,'Prime Survivor');assert.equal(sources.read(B,'prime-observed').sourceAt,START+180000);
 const life=tracker._test.activeLife(B);assert.equal(life.prime_preexisting,1);assert.equal(life.prime_started_at,null);
 assert.equal(tracker._test.db.prepare('SELECT kind FROM prime_tracker_prime_observations WHERE life_id=?').get(life.id).kind,'first-seen-prime');
 sample(B,false,START+240000);sample(B,true,START+300000);assert.equal(sources.read(B,'prime-observed').sourceAt,START+180000);
});
test('unknown/stale/malformed/future samples and adult growth alone cannot create a dated Prime observation',()=>{
 const db=tracker._test.db;sample(C,false,START+600000);const before=db.prepare('SELECT total_changes() n').get().n;
 for(const at of [null,undefined,'invalid','2026-11-06T01:02:03',iso(Date.now()+3600000)])assert.equal(tracker.recordSnapshot([{steamId:C,isPrime:true,growth:1,species:'Rex'}],at,{env}).skipped,true);
 assert.equal(db.prepare('SELECT total_changes() n').get().n,before);sample(C,true,START+599999);assert.equal(badge(C),undefined);
 tracker.recordSnapshot([{steamId:C,growth:100,species:'Rex'}],iso(START+660000),{env});assert.equal(badge(C),undefined);
 assert.equal(db.prepare('SELECT count(*) n FROM prime_tracker_prime_observations WHERE steam_id=?').get(C).n,0);
});
test('a failed first-positive receipt rolls back tracker life/zone writes and can retry the same source observation',()=>{
 const db=tracker._test.db;db.exec("CREATE TRIGGER refuse_prime_observation BEFORE INSERT ON prime_tracker_prime_observations BEGIN SELECT RAISE(ABORT,'observation unavailable'); END");
 const warn=console.warn;console.warn=()=>{};let failed;try{failed=sample(D,true,START+720000);}finally{console.warn=warn;}
 assert.equal(failed.tracked,0);assert.equal(tracker._test.activeLife(D),null);assert.equal(badge(D),undefined);
 db.exec('DROP TRIGGER refuse_prime_observation');assert.equal(sample(D,true,START+720000).tracked,1);assert.equal(badge(D).title,'Prime Survivor');assert.equal(sources.read(D,'prime-observed').sourceAt,START+720000);
});
test('an older undated Prime life is not backfilled or replaced by a later known observation',()=>{
 const db=tracker._test.db;db.prepare('INSERT INTO prime_tracker_lives(id,steam_id,species,started_at,last_seen_at,is_prime,prime_preexisting,ended_at) VALUES(?,?,?,?,?,1,1,?)')
  .run(randomUUID(),E,'Rex',iso(START-86400000),iso(START-86340000),iso(START-86300000));
 sample(E,true,START+780000);assert.equal(badge(E).title,'Prime Survivor');assert.equal(sources.read(E,'prime-observed'),null);
 assert.equal(db.prepare('SELECT count(*) n FROM prime_tracker_prime_observations WHERE steam_id=?').get(E).n,1);
 progression.unlockEligibleAchievements(E);assert.equal(sources.read(E,'prime-observed'),null);
});
test('source binding changes or removal withhold timing without read-time writes or rebinding the permanent achievement',()=>{
 const db=tracker._test.db,life=tracker._test.activeLife(D);const before=sources.read(D,'prime-observed');assert.equal(before.available,true);
 db.prepare('UPDATE prime_tracker_prime_observations SET species_key=? WHERE life_id=?').run('trike',life.id);
 const changes=economy.db.prepare('SELECT total_changes() n').get().n;assert.equal(sources.read(D,'prime-observed').available,false);assert.equal(economy.db.prepare('SELECT total_changes() n').get().n,changes);
 db.prepare('UPDATE prime_tracker_prime_observations SET species_key=? WHERE life_id=?').run('rex',life.id);assert.equal(sources.read(D,'prime-observed').sourceAt,before.sourceAt);
 db.prepare('DELETE FROM prime_tracker_lives WHERE id=?').run(life.id);assert.equal(db.prepare('SELECT count(*) n FROM prime_tracker_prime_observations WHERE life_id=?').get(life.id).n,0);
 assert.equal(sources.read(D,'prime-observed').available,false);assert.equal(economy.db.prepare("SELECT count(*) n FROM progression_achievements WHERE steam_id=? AND achievement_id='prime-observed'").get(D).n,1);
});
