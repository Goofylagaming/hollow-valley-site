"use strict";
const test = require('node:test'), assert = require('node:assert/strict'), { DatabaseSync } = require('node:sqlite');
const { createAchievementSourceTimeStore } = require('../src/services/achievementSourceTime');
const { createTerritoryVictoryStore } = require('../src/services/territoryVictoryStore');
const { createSeasonTrackStore, describe } = require('../src/services/seasonTrackStore');
const A='76561198000000401',B='76561198000000402',C='76561198000000403',START=Date.parse('2027-01-01T00:00:00Z');
const iso=at=>new Date(at).toISOString(), species=['tyrannosaurus','omniraptor','troodon','gallimimus','dryosaurus'];
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(`CREATE TABLE progression_achievements(steam_id TEXT,achievement_id TEXT,metadata_json TEXT,unlocked_at TEXT,PRIMARY KEY(steam_id,achievement_id));
  CREATE TABLE progression_xp_ledger(id TEXT PRIMARY KEY,steam_id TEXT,amount INTEGER,source TEXT,reference_type TEXT,created_at TEXT);
  CREATE TABLE progression_xp_source_times(ledger_id TEXT PRIMARY KEY,source_at INTEGER,basis TEXT);
  CREATE TABLE combat_events(id TEXT PRIMARY KEY,occurred_at TEXT,killer_steam_id TEXT,victim_steam_id TEXT,victim_species TEXT,source TEXT);
  CREATE TABLE wallet_fixture(balance INTEGER);INSERT INTO wallet_fixture VALUES(1234);`);
 let clock=START-1000;
 const sources=createAchievementSourceTimeStore(db,{now:()=>clock}),territory=createTerritoryVictoryStore(db,{now:()=>clock}),seasons=createSeasonTrackStore(db,{now:()=>clock});
 const def={id:'synthetic-battle-season',title:'Synthetic battle achievements',startsAt:iso(START),endsAt:iso(START+86400000),settlesAt:iso(START+2*86400000),retainUntil:iso(START+30*86400000),free:true,sources:[],tiers:[{xp:100,title:'Synthetic milestone'}],
  achievementPoints:{policy:'qualifying-source-time',awards:[{id:'combat-species-5',xp:50},{id:'territory-victory',xp:75}]}},digest=describe(def).digest;
 seasons.stage(def,{reviewer:A,digest});seasons.changeState(def.id,{reviewer:A,digest,action:'publish',expectedRevision:1});clock=START;seasons.enroll(def.id,A);clock=START+1200000;
 const combat=(id,victimSpecies,at,killer=A,victim=B)=>db.prepare('INSERT INTO combat_events VALUES(?,?,?,?,?,?)').run(id,typeof at==='number'?iso(at):at,killer,victim,victimSpecies,'synthetic-protected-feed');
 const five=()=>species.forEach((sp,i)=>combat('species-'+i,sp,START+(i+1)*60000));
 const result={version:1,attackId:1,eventId:11,startedAt:START+60000,resolvedAt:START+600000,outcome:'capture',provenance:'recorded-live',winners:[A,B]};
 function award(id){const combat=id==='combat-species-5';db.exec('BEGIN IMMEDIATE');try{db.prepare('INSERT INTO progression_achievements VALUES(?,?,?,?)').run(A,id,JSON.stringify({type:combat?'combat_species':'territory_victories',threshold:combat?5:1,value:combat?5:1}),iso(clock));const recorded=sources.recordNewAward(A,id);db.exec('COMMIT');return recorded;}catch(error){db.exec('ROLLBACK');throw error;}}
 return {db,sources,territory,seasons,def,result,combat,five,award};
}
test('combat diversity uses the fifth distinct recorded event-time species, excluding repeated, unknown, self and unrelated events',t=>{
 const f=fixture(t);f.five();f.combat('repeat','BP_Tyrannosaurus_C',START+360000);f.combat('unknown','ImaginaryDino',START+10000);f.combat('self','deinosuchus',START+10000,A,A);f.combat('other','deinosuchus',START+10000,B,A);f.combat('environment','deinosuchus',START+10000,null,A);
 assert.equal(f.award('combat-species-5'),true);const source=f.sources.read(A,'combat-species-5');assert.equal(source.sourceAt,START+300000);assert.equal(source.basis,'combat-species-threshold');
 f.seasons.reconcile(f.def.id,A);assert.equal(f.seasons.progress(f.def.id,A).xp,50);
 f.combat('later-sixth','deinosuchus',START+420000);assert.equal(f.sources.read(A,'combat-species-5').sourceAt,START+300000);
 assert.equal(f.db.prepare('SELECT count(*) n FROM progression_xp_ledger').get().n,0);assert.equal(f.db.prepare('SELECT balance FROM wallet_fixture').get().balance,1234);
});
test('missing/changed qualifying combat events, unknown dates and earlier late imports never rewrite an existing source clock',t=>{
 const f=fixture(t);f.five();f.award('combat-species-5');f.seasons.reconcile(f.def.id,A);
 const receipt=f.db.prepare("SELECT * FROM progression_achievement_sources WHERE achievement_id='combat-species-5'").get();
 f.db.exec("DELETE FROM combat_events WHERE id='species-4'");assert.equal(f.sources.read(A,'combat-species-5').available,false);assert.equal(f.seasons.progress(f.def.id,A).xp,0);
 f.combat('later-replacement','dryosaurus',START+660000);assert.equal(f.sources.read(A,'combat-species-5').available,false);assert.deepEqual(f.db.prepare("SELECT * FROM progression_achievement_sources WHERE achievement_id='combat-species-5'").get(),receipt);
 const unknown=fixture(t);unknown.five();unknown.combat('unknown-clock','deinosuchus','2027-01-01T00:00:00');assert.equal(unknown.award('combat-species-5'),false);
 const early=fixture(t);early.five();early.award('combat-species-5');early.combat('late-earlier','dryosaurus',START+1000);assert.equal(early.sources.read(A,'combat-species-5').available,false);
});
test('Territory points bind capture resolution and the complete frozen winning roster, without asserting battle survival',t=>{
 const f=fixture(t);f.territory.ingest(f.result);assert.equal(f.award('territory-victory'),true);assert.equal(f.sources.read(A,'territory-victory').sourceAt,f.result.resolvedAt);
 assert.equal(f.sources.read(A,'territory-victory').basis,'territory-capture-resolution');f.seasons.reconcile(f.def.id,A);assert.equal(f.seasons.progress(f.def.id,A).xp,75);
 const before=f.db.prepare('SELECT total_changes() n').get().n;f.sources.read(A,'territory-victory');assert.equal(f.db.prepare('SELECT total_changes() n').get().n,before);
 f.db.prepare('INSERT INTO progression_territory_winners VALUES(?,?)').run(1,C);assert.equal(f.sources.read(A,'territory-victory').available,false);assert.equal(f.seasons.progress(f.def.id,A).xp,0);
});
test('orphan winners, contradictory provenance/times/rosters and reused event identities cannot date a Territory award',t=>{
 const orphan=fixture(t);orphan.db.prepare('INSERT INTO progression_territory_winners VALUES(?,?)').run(1,A);assert.equal(orphan.award('territory-victory'),false);
 for(const change of [{provenance:'simulated'},{outcome:'defence'},{resolvedAt:'2027-01-01T00:10:00Z'},{attackId:2},{winners:[A,A]},{winners:[B]}]){
  const f=fixture(t);f.territory.ingest(f.result);f.db.prepare('UPDATE progression_territory_results SET payload_json=?').run(JSON.stringify({...f.result,...change}));assert.equal(f.award('territory-victory'),false);
 }
 const duplicate=fixture(t);duplicate.territory.ingest(duplicate.result);duplicate.territory.ingest({...duplicate.result,attackId:2});assert.equal(duplicate.award('territory-victory'),false);
});
