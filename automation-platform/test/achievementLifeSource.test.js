"use strict";
const test = require('node:test'), assert = require('node:assert/strict'), { DatabaseSync } = require('node:sqlite');
const { createAchievementSourceTimeStore } = require('../src/services/achievementSourceTime');
const { createSeasonTrackStore, describe } = require('../src/services/seasonTrackStore');
const A = '76561198000000401', B = '76561198000000402', START = Date.parse('2027-01-01T00:00:00Z'), THROUGH = START + 36000000;
const iso = at => new Date(at).toISOString();
function fixture(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec(`CREATE TABLE progression_achievements(steam_id TEXT,achievement_id TEXT,metadata_json TEXT,unlocked_at TEXT,PRIMARY KEY(steam_id,achievement_id));
    CREATE TABLE progression_xp_ledger(id TEXT PRIMARY KEY,steam_id TEXT,amount INTEGER,source TEXT,reference_type TEXT,created_at TEXT);
    CREATE TABLE progression_xp_source_times(ledger_id TEXT PRIMARY KEY,source_at INTEGER,basis TEXT);
    CREATE TABLE vl_lives(id TEXT PRIMARY KEY,steam_id TEXT,species TEXT,started_at INTEGER,last_at INTEGER,ended_at INTEGER);
    CREATE TABLE vl_records(scope TEXT,metric TEXT,subject TEXT,value REAL,achieved_at INTEGER);
    CREATE TABLE vl_events(id TEXT PRIMARY KEY,payload TEXT,occurred_at INTEGER);
    CREATE TABLE vl_parents(child TEXT,parent TEXT);CREATE TABLE vl_growth_milestones(life_id TEXT,juvenile_at INTEGER,adult_at INTEGER);
    CREATE TABLE combat_events(id TEXT PRIMARY KEY,victim_steam_id TEXT,occurred_at TEXT);
    CREATE TABLE progression_achievement_review_state(steam_id TEXT,achievement_id TEXT,status TEXT);
    CREATE TABLE progression_achievement_evidence_reviews(steam_id TEXT,achievement_id TEXT,status TEXT);`);
  const life = db.prepare('INSERT INTO vl_lives VALUES(?,?,?,?,?,NULL)'); life.run('child', A, 'Rex', START, THROUGH); life.run('parent', B, 'Rex', START - 1000, THROUGH);
  db.prepare('INSERT INTO vl_records VALUES(?,?,?,?,?)').run('all','survival_seconds','child',36000,THROUGH);
  db.prepare('INSERT INTO vl_growth_milestones VALUES(?,?,?)').run('child',START + 60000,START + 120000);
  db.prepare('INSERT INTO vl_parents VALUES(?,?)').run('child','parent');
  db.prepare('INSERT INTO vl_events VALUES(?,?,?)').run('hatch:child',JSON.stringify({type:'hatch',child:'child',parents:['parent'],evidence:'synthetic-hatch-evidence'}),START + 120000);
  let clock = START - 1000;
  const sources = createAchievementSourceTimeStore(db,{now:()=>clock}), seasons = createSeasonTrackStore(db,{now:()=>clock});
  const def = { id:'synthetic-life-season',title:'Synthetic life achievements',startsAt:iso(START),endsAt:iso(START+7*86400000),settlesAt:iso(START+8*86400000),retainUntil:iso(START+30*86400000),free:true,sources:[],tiers:[{xp:100,title:'Synthetic milestone'}],
    achievementPoints:{policy:'qualifying-source-time',awards:[{id:'nested-adult',xp:50},{id:'life-survival-10h',xp:75}]} }, digest=describe(def).digest;
  seasons.stage(def,{reviewer:A,digest});seasons.changeState(def.id,{reviewer:A,digest,action:'publish',expectedRevision:1});clock=START;seasons.enroll(def.id,A);clock=THROUGH+60000;
  function award(id) {
    const nested=id==='nested-adult',meta={type:nested?'nested_adult':'life_survival_seconds',threshold:nested?1:36000,value:nested?1:36000,evidence:nested?{lifeId:'child',juvenileAt:START+60000,adultAt:START+120000}:{lifeId:'child',observedThrough:THROUGH}};
    db.exec('BEGIN IMMEDIATE');try { db.prepare('INSERT INTO progression_achievements VALUES(?,?,?,?)').run(A,id,JSON.stringify(meta),iso(clock));const recorded=sources.recordNewAward(A,id);db.exec('COMMIT');return recorded; }catch(error){db.exec('ROLLBACK');throw error;}
  }
  return {db,sources,seasons,def,award};
}
test('nested adulthood and life-survival points use the original observation and survive later legitimate life growth',t=>{
  const f=fixture(t);assert.equal(f.award('nested-adult'),true);assert.equal(f.award('life-survival-10h'),true);
  assert.equal(f.sources.read(A,'nested-adult').sourceAt,START+120000);assert.equal(f.sources.read(A,'life-survival-10h').sourceAt,THROUGH);
  f.seasons.reconcile(f.def.id,A);assert.equal(f.seasons.progress(f.def.id,A).xp,125);
  f.db.prepare('UPDATE vl_lives SET last_at=? WHERE id=?').run(THROUGH+600000,'child');f.db.prepare('UPDATE vl_records SET value=?,achieved_at=?').run(36600,THROUGH+600000);
  assert.equal(f.sources.read(A,'life-survival-10h').sourceAt,THROUGH);assert.equal(f.seasons.progress(f.def.id,A).xp,125);
  f.db.prepare('INSERT INTO combat_events VALUES(?,?,?)').run('later-life-death',A,iso(THROUGH+300000));assert.equal(f.seasons.progress(f.def.id,A).xp,125);
});
test('late combat and Legacy deaths invalidate copied points before profile review, without writing or deleting permanent achievements',t=>{
  const f=fixture(t);f.award('nested-adult');f.award('life-survival-10h');f.seasons.reconcile(f.def.id,A);
  f.db.prepare('INSERT INTO combat_events VALUES(?,?,?)').run('death-during-growth',A,iso(START+90000));
  const before=f.db.prepare('SELECT total_changes() n').get().n;assert.equal(f.seasons.progress(f.def.id,A).xp,0);assert.equal(f.seasons.progress(f.def.id,A).evidenceUnavailable,true);
  assert.equal(f.db.prepare('SELECT total_changes() n').get().n,before);assert.equal(f.db.prepare('SELECT count(*) n FROM progression_achievements').get().n,2);
  f.db.exec('DELETE FROM combat_events');f.db.prepare('INSERT INTO vl_events VALUES(?,?,?)').run('legacy-late-death',JSON.stringify({type:'combat_death',steamId:A}),START+90000);
  assert.equal(f.sources.read(A,'nested-adult').available,false);assert.equal(f.sources.read(A,'life-survival-10h').available,false);
});
test('changed life ownership, growth or verified lineage cannot preserve a seasonal entitlement',t=>{
  for(const mutation of ["UPDATE vl_lives SET steam_id='76561198000000402' WHERE id='child'","UPDATE vl_growth_milestones SET adult_at=adult_at+1","DELETE FROM vl_parents","UPDATE vl_events SET payload='{}' WHERE id='hatch:child'","UPDATE vl_events SET payload='invalid-json' WHERE id='hatch:child'","UPDATE vl_lives SET species='Trike' WHERE id='parent'","UPDATE vl_events SET occurred_at="+(THROUGH+120000)+" WHERE id='hatch:child'"]){
    const f=fixture(t);f.award('nested-adult');f.db.exec(mutation);assert.equal(f.sources.read(A,'nested-adult').available,false,mutation);
  }
});
test('unknown death clocks, insufficient/malformed survival evidence and an early life ending never acquire usable source timing',t=>{
  for(const mutation of ["UPDATE vl_records SET value=35999","UPDATE vl_records SET achieved_at=achieved_at-1","UPDATE vl_lives SET ended_at="+(THROUGH-1)+" WHERE id='child'","INSERT INTO combat_events VALUES('unknown','76561198000000401','2027-01-01T01:00:00')"]){
    const f=fixture(t);f.db.exec(mutation);assert.equal(f.award('life-survival-10h'),false,mutation);
  }
});
