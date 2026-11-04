"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {randomUUID}=require("node:crypto");

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"hv-prime-zone-reset-"));
process.env.AUTOMATION_DB_PATH=path.join(dir,"automation.sqlite");
const prime=require("../src/services/primeTrackerService");
const db=prime._test.db;
const env={PRIME_TRACKER_ENABLED:"true"};
const alice="76561198000000101", bob="76561198000000102";
test.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});

function trackedZonePosition(){
  const layers=prime.loadZoneLayers();
  const zone=[...layers.migrations,...layers.patrolZones,...layers.sanctuaries]
    .find(x=>x.shape==="ellipse" && Number.isFinite(x.left) && Number.isFinite(x.top));
  assert.ok(zone,"Gateway must contain a mapped zone with a known centre for tests");
  return {
    x:-505000+zone.left*1112000,
    y:-607000+zone.top*1116000,
    z:0,
  };
}
const position=trackedZonePosition();
assert.ok(
  prime.zoneMembership(position).migrations.length +
  prime.zoneMembership(position).patrolZones.length +
  prime.zoneMembership(position).sanctuaries.length>0,
  "Mapped zone center must resolve to a zone visit"
);
const outside={x:1000000000,y:1000000000,z:0};
function observation(id,{growth=1,isPrime=true,location=position,species="Tyrannosaurus"}={}){
  return {steamId:id,species,growth,isPrime,location};
}
function sample(id,time,options={}){
  const result=prime.recordSnapshot([observation(id,options)],new Date(time).toISOString(),{env});
  assert.equal(result.skipped,false);
}
const now=Date.now();
sample(alice,now-180000);
sample(alice,now-120000);
sample(bob,now-180000);
sample(bob,now-120000);
const original=prime.trackerState(alice,env);
const targetLife=original.activeLife.id;
const oldVisits=original.zoneVisits.slice();
const before=db.prepare("SELECT * FROM prime_tracker_lives WHERE id=?").get(targetLife);
test("existing zone visits and Prime state are stored independently",()=>{
  assert.ok(oldVisits.length>=1);
  assert.ok(original.progress.primeSeconds>0);
  assert.equal(original.progress.isPrime,true);
  assert.equal(original.activeLife.primePreexisting,true);
  assert.equal(before.prime_seconds,60);
});
test("wrong player, stale life and missing confirmation cannot reset another dinosaur",()=>{
  assert.throws(()=>prime.resetZoneVisits({
    steamId:bob,lifeId:targetLife,requestId:randomUUID(),confirm:"RESET ZONES"
  },env),{code:"STALE_LIFE",status:409});
  assert.throws(()=>prime.resetZoneVisits({
    steamId:alice,lifeId:targetLife,requestId:randomUUID(),confirm:"RESET"
  },env),{code:"CONFIRM_REQUIRED"});
  assert.throws(()=>prime.resetZoneVisits({
    steamId:alice,lifeId:randomUUID(),requestId:randomUUID(),confirm:"RESET ZONES"
  },env),{code:"STALE_LIFE"});
  assert.throws(()=>prime.resetZoneVisits({
    steamId:alice,lifeId:targetLife,requestId:randomUUID(),confirm:"RESET ZONES"
  },{PRIME_TRACKER_ENABLED:"false"}),{code:"TRACKER_DISABLED",status:503});
  assert.equal(prime.trackerState(alice,env).zoneVisits.length,oldVisits.length);
  assert.equal(prime.trackerState(bob,env).zoneVisits.length,oldVisits.length);
});
let firstReset,firstId=randomUUID();
test("one confirmed reset archives exactly this life's visits and leaves Prime identity untouched",()=>{
  firstReset=prime.resetZoneVisits({
    steamId:alice,lifeId:targetLife,requestId:firstId,confirm:"RESET ZONES"
  },env);
  assert.equal(firstReset.ok,true);
  assert.equal(firstReset.duplicate,false);
  assert.equal(firstReset.clearedZones,oldVisits.length);
  assert.equal(firstReset.lifeId,targetLife);
  const tracker=prime.trackerState(alice,env);
  assert.equal(tracker.zoneVisits.length,0);
  assert.equal(tracker.progress.migrationZonesVisited,0);
  assert.equal(tracker.progress.patrolZonesVisited,0);
  assert.equal(tracker.progress.sanctuariesVisited,0);
  assert.equal(tracker.progress.isPrime,true);
  assert.equal(tracker.progress.primeSeconds,original.progress.primeSeconds);
  assert.equal(tracker.progress.primePreexisting,true);
  assert.equal(tracker.activeLife.id,targetLife);
  assert.ok(tracker.activeLife.zoneResetAt);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM prime_tracker_zone_visits WHERE life_id=?").get(targetLife).n,0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM prime_tracker_zone_resets").get().n,1);
  const archival=db.prepare("SELECT * FROM prime_tracker_zone_resets WHERE id=?").get(firstId);
  assert.equal(archival.steam_id,alice);
  assert.equal(archival.life_id,targetLife);
  assert.equal(JSON.parse(archival.archived_visits_json).length,oldVisits.length);
  const after=db.prepare("SELECT * FROM prime_tracker_lives WHERE id=?").get(targetLife);
  for(const key of ["is_prime","prime_seconds","prime_preexisting","prime_started_at","species","started_at"]){
    assert.equal(after[key],before[key],"Reset cannot modify "+key);
  }
  assert.equal(prime.trackerState(bob,env).zoneVisits.length,oldVisits.length);
});
test("retries are idempotent and a new nonce during the cooldown is rejected",()=>{
  const again=prime.resetZoneVisits({
    steamId:alice,lifeId:targetLife,requestId:firstId,confirm:"RESET ZONES"
  },env);
  assert.equal(again.duplicate,true);
  assert.equal(again.clearedZones,oldVisits.length);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM prime_tracker_zone_resets").get().n,1);
  assert.throws(()=>prime.resetZoneVisits({
    steamId:alice,lifeId:targetLife,requestId:randomUUID(),confirm:"RESET ZONES"
  },env),{code:"RESET_COOLDOWN",status:429});
  assert.throws(()=>prime.resetZoneVisits({
    steamId:bob,lifeId:targetLife,requestId:firstId,confirm:"RESET ZONES"
  },env),{code:"RESET_CONFLICT",status:409});
});
test("stale samples cannot recreate visits, and the current zone needs exit/re-entry",()=>{
  // The original position is still recorded but only belongs to the old window.
  const duplicateTime=Date.parse(firstReset.resetAt)-10000;
  sample(alice,duplicateTime);
  assert.equal(prime.trackerState(alice,env).zoneVisits.length,0);
  sample(alice,Date.parse(firstReset.resetAt)+1500);
  assert.equal(prime.trackerState(alice,env).zoneVisits.length,0,
    "Zone occupied at reset must not instantly count again");
  sample(alice,Date.parse(firstReset.resetAt)+3000,{location:outside});
  assert.equal(prime.trackerState(alice,env).zoneVisits.length,0);
  sample(alice,Date.parse(firstReset.resetAt)+4500);
  assert.ok(prime.trackerState(alice,env).zoneVisits.length>0,
    "Moving out and back into the same zone must start a new count");
  const audit=db.prepare("SELECT archived_visits_json FROM prime_tracker_zone_resets WHERE id=?").get(firstId);
  assert.equal(JSON.parse(audit.archived_visits_json).length,oldVisits.length);
});
test("entomb-like growth reset creates a new life, retains old Prime and archived zones",()=>{
  const when=Date.parse(firstReset.resetAt)+10000;
  sample(alice,when,{growth:0.05,isPrime:false});
  const fresh=prime.trackerState(alice,env);
  assert.notEqual(fresh.activeLife.id,targetLife);
  assert.equal(fresh.activeLife.isPrime,false);
  assert.equal(fresh.progress.primeSeconds,0);
  assert.equal(fresh.history.some(l=>l.id===targetLife && l.isPrime),true);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM prime_tracker_zone_resets WHERE life_id=?").get(targetLife).n,1);
  assert.throws(()=>prime.resetZoneVisits({
    steamId:alice,lifeId:targetLife,requestId:randomUUID(),confirm:"RESET ZONES"
  },env),{code:"STALE_LIFE",status:409});
});
