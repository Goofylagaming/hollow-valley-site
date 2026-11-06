"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const {sourceTime,createBridgeWorkerHealthStore,captureManagementObservation,MAX_AGE_MS}=require('../server/services/bridgeWorkerHealth');
const AT=Date.parse('2026-11-06T01:02:03.123Z'),sample=(at=AT,state='Running')=>({sampledAt:new Date(at).toISOString(),tasks:{command_bridge:state}});
function fixture(t){const db=new DatabaseSync(':memory:');t.after(()=>db.close());let clock=AT;const store=createBridgeWorkerHealthStore(db,{now:()=>clock});return {db,store,clock:value=>{clock=value;}};}
test('source clocks accept actual UTC milliseconds and Windows precision without guessing invalid/ambiguous clocks',()=>{
 assert.equal(sourceTime('2026-11-06T01:02:03.1234567Z'),AT);assert.equal(sourceTime('2026-11-06T01:02:03.1Z'),AT-23);assert.equal(sourceTime('2026-11-06T01:02:03Z'),AT-123);
 for(const value of [null,AT,'2026-11-06T01:02:03','2026-11-06 01:02:03','2026-02-30T01:02:03Z','2026-11-06T24:00:00Z','2026-11-06T01:02:03.12345678Z'])assert.equal(sourceTime(value),null);
});
test('fresh allowed task states have explicit task-only provenance, and public reads do not mutate or copy private heartbeat fields',t=>{
 const f=fixture(t);assert.equal(f.store.read().code,'no-observation');const raw={...sample(),server:{pid:1234,address:'127.0.0.1'},logs:{bridge:['PRIVATE 76561198000000001 token=secret']},agentToken:'private-token'};
 assert.equal(f.store.record(raw).accepted,true);const changes=f.db.prepare('SELECT total_changes() n').get().n,value=f.store.read();assert.equal(value.code,'running');assert.equal(value.executionVerified,false);assert.equal(value.scope,'windows-scheduled-task');assert.doesNotMatch(JSON.stringify(value),/76561198|127\.0|1234|token|PRIVATE|server|logs/);assert.equal(f.db.prepare('SELECT total_changes() n').get().n,changes);
 for(const [i,state]of ['Ready','Disabled','Missing','Queued','Unknown'].entries()){f.clock(AT+i+1);f.store.record(sample(AT+i+1,state));assert.equal(f.store.read().code,state==='Queued'?'queued':state==='Unknown'?'unknown-state':'not-running');}
});
test('replayed, stale and conflicting samples cannot move a receiving clock or overwrite a newer task observation',t=>{
 const f=fixture(t);f.store.record(sample());const received=f.db.prepare('SELECT received_at FROM hv_bridge_worker_observation').get().received_at;f.clock(AT+10000);
 assert.equal(f.store.record(sample()).reason,'duplicate');assert.equal(f.store.record(sample(AT,'Disabled')).reason,'stale-or-conflicting');assert.equal(f.store.record(sample(AT-1,'Missing')).accepted,false);
 assert.equal(f.db.prepare('SELECT received_at FROM hv_bridge_worker_observation').get().received_at,received);assert.equal(f.store.read().observedAt,new Date(AT).toISOString());f.clock(AT+MAX_AGE_MS+1);assert.equal(f.store.read().code,'stale');
});
test('future source/receiving clocks stay unverified; old timestamps remain old even when first received now',t=>{
 const f=fixture(t);assert.equal(f.store.record(sample(AT+120001)).accepted,false);f.store.record(sample(AT+1000));assert.equal(f.store.read().code,'unverified-clock');f.clock(AT+1000);assert.equal(f.store.read().code,'running');
 f.db.prepare('UPDATE hv_bridge_worker_observation SET received_at=?').run(AT+2000);assert.equal(f.store.read().code,'unverified-clock');
 const g=fixture(t);g.store.record(sample(AT-MAX_AGE_MS-1));assert.equal(g.store.read().code,'stale');
});
test('disabled capture, old agents and public reads never create monitoring schema or upgrade missing task facts',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());assert.equal(captureManagementObservation(sample(),{db,env:{}}).reason,'disabled');
 for(const raw of [{tasks:{command_bridge:'Running'}},{sampledAt:new Date(AT).toISOString(),tasks:{}},sample(AT,'healthy')])assert.equal(captureManagementObservation(raw,{db,env:{STATUS_COMPONENTS_COLLECTION_ENABLED:'1'}}).accepted,false);
 assert.equal(createBridgeWorkerHealthStore(db,{initialize:false,now:()=>AT}).read().code,'no-observation');assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='hv_bridge_worker_observation'").get().n,0);
});
test('a failed receipt leaves the original source unchanged and malformed persisted evidence is withheld',t=>{
 const f=fixture(t);f.store.record(sample());f.clock(AT+1);f.db.exec("CREATE TRIGGER reject_observation BEFORE INSERT ON hv_bridge_worker_observation BEGIN SELECT RAISE(ABORT,'observation unavailable');END");assert.throws(()=>f.store.record(sample(AT+1,'Disabled')),/observation unavailable/);assert.equal(f.store.read().code,'running');f.db.exec('DROP TRIGGER reject_observation');f.store.record(sample(AT+1,'Disabled'));assert.equal(f.store.read().code,'not-running');f.db.exec("UPDATE hv_bridge_worker_observation SET task_state='private raw exception'");assert.equal(f.store.read().code,'unavailable');assert.equal(f.store.read().observedAt,null);
});
