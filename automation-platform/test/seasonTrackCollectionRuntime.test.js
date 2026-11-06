"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
process.env.AUTOMATION_DB_PATH=':memory:';
for(const key of ['SEASON_TRACK_ENABLED','SEASON_TRACK_MANAGEMENT_ENABLED','SEASON_TRACK_COLLECTION_ENABLED','SEASON_TRACK_MAINTENANCE_ENABLED','SEASON_TRACK_READ_ONLY'])delete process.env[key];
const service=require('../src/services/seasonTrackService'),A='76561198000000401',B='76561198000000402';
test('background rollout requires both flags, prepared schema and a writable runtime; failed cleanup does not stop progress collection',()=>{
 const economyPath=require.resolve('../src/services/economyStore');assert.equal(require.cache[economyPath],undefined);
 assert.deepEqual(service.collect(),{skipped:true});process.env.SEASON_TRACK_COLLECTION_ENABLED='1';assert.deepEqual(service.collect(),{skipped:true});assert.equal(require.cache[economyPath],undefined);
 let callback,cancelled=0,scheduled=0;const timer={unref(){}};const reports=[];
 const options={schedule(fn,ms){scheduled++;callback=fn;assert.equal(ms,60000);return timer;},cancel(value){assert.equal(value,timer);cancelled++;},report:area=>reports.push(area)};
 assert.equal(service.start(options),timer);callback();assert.equal(reports.length,0);assert.equal(require.cache[economyPath],undefined);service.stop();assert.equal(cancelled,1);
 process.env.SEASON_TRACK_ENABLED='1';assert.throws(service.collect,{status:503});const economy=require(economyPath);
 try{
  assert.equal(economy.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name LIKE 'progression_season_%'").get().n,0);
  require('../src/services/progressionService');const {createSeasonTrackStore,describe}=require('../src/services/seasonTrackStore');const NOW=Date.now(),DAY=86400000;let clock=NOW-8*DAY;
  const store=createSeasonTrackStore(economy.db,{now:()=>clock}),iso=x=>new Date(x).toISOString();
  function prepare(id,start,end,settle,retention,who){const def={id,title:'Synthetic runtime collection',startsAt:iso(start),endsAt:iso(end),settlesAt:iso(settle),retainUntil:iso(retention),free:true,sources:[{source:'quest',policy:'achievement-time'}],tiers:[{xp:10,title:'Synthetic milestone'}]},digest=describe(def).digest;store.stage(def,{reviewer:A,digest});store.changeState(id,{reviewer:A,digest,action:'publish',expectedRevision:1});clock=start;store.enroll(id,who);return def;}
  const expired=prepare('synthetic-expired-collector',NOW-7*DAY,NOW-6*DAY,NOW-5*DAY,NOW-DAY,B);clock=NOW-2000;
  const active=prepare('synthetic-active-collector',NOW-1000,NOW+DAY,NOW+2*DAY,NOW+30*DAY,A);clock=NOW;
  function grant(id){economy.db.prepare("INSERT INTO progression_xp_ledger(id,steam_id,amount,source,reason,idempotency_key,reference_type,created_at) VALUES(?,?,10,'quest','Synthetic',?,'quest',?)").run(id,A,id,iso(NOW));economy.db.prepare("INSERT INTO progression_xp_source_times VALUES(?,?,'quest-achievement')").run(id,NOW);}
  grant('runtime-source-1');const before=economy.db.prepare('SELECT total_changes() n').get().n;
  process.env.SEASON_TRACK_READ_ONLY='1';assert.deepEqual(service.collect(),{skipped:true});assert.equal(economy.db.prepare('SELECT total_changes() n').get().n,before);delete process.env.SEASON_TRACK_READ_ONLY;
  process.env.SEASON_TRACK_ENABLED='0';assert.deepEqual(service.collect(),{skipped:true});process.env.SEASON_TRACK_ENABLED='1';
  assert.equal(service.collect().accepted,1);assert.equal(store.progress(active.id,A).xp,10);assert.equal(economy.db.prepare('SELECT count(*) n FROM progression_players').get().n,0);
  grant('runtime-source-2');process.env.SEASON_TRACK_MAINTENANCE_ENABLED='1';
  economy.db.exec(`CREATE TRIGGER refuse_cleanup BEFORE DELETE ON progression_season_enrollments WHEN OLD.season_id='${expired.id}' BEGIN SELECT RAISE(ABORT,'Synthetic cleanup failure');END`);
  assert.equal(service.start(options),timer);assert.equal(service.start(options),timer);assert.equal(scheduled,2);assert.deepEqual(reports,['maintenance']);assert.equal(store.progress(active.id,A).xp,20,'collector still runs after cleanup fails');
  economy.db.exec('DROP TRIGGER refuse_cleanup');callback();assert.equal(economy.db.prepare('SELECT count(*) n FROM progression_season_collection_queue WHERE season_id=?').get(expired.id).n,0);
  service.stop();assert.equal(cancelled,2);
 }finally{service.stop();economy.db.close();}
});
