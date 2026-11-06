"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Worker}=require('node:worker_threads'),{DatabaseSync}=require('node:sqlite');
const {createSeasonTrackStore,describe}=require('../src/services/seasonTrackStore');
const source=`const {parentPort,workerData:d}=require('node:worker_threads');const {DatabaseSync}=require('node:sqlite');
 const db=new DatabaseSync(d.file);db.exec('PRAGMA busy_timeout=5000');const store=require(d.module).createSeasonTrackStore(db,{initialize:false,now:()=>d.now});
 parentPort.once('message',()=>{try{parentPort.postMessage({result:store.collect({limit:1,evidenceLimit:1})});}catch(e){parentPort.postMessage({error:e.message});}finally{db.close();}});parentPort.postMessage({ready:true});`;
async function startWorker(data) {
 const instance=new Worker(source,{eval:true,workerData:data});let readyResolve,readyReject,resultResolve,resultReject;
 const ready=new Promise((a,b)=>{readyResolve=a;readyReject=b;}),result=new Promise((a,b)=>{resultResolve=a;resultReject=b;});result.catch(()=>{});
 instance.on('message',message=>message.ready?readyResolve():resultResolve(message));instance.on('error',error=>{readyReject(error);resultReject(error);});
 const exit=new Promise(resolve=>instance.once('exit',resolve));await ready;return {go:()=>instance.postMessage('go'),result,exit,stop:()=>instance.terminate()};
}
test('independent collectors serialize checkpoints and remain fair, retry-safe and stable across VACUUM and process restarts',{timeout:30000},async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hv-season-collection-race-')),file=path.join(directory,'synthetic.sqlite'),db=new DatabaseSync(file),children=[];
 const A='76561198000000401',B='76561198000000402',START=Date.parse('2027-01-01T00:00:00Z'),iso=x=>new Date(x).toISOString();let clock=START-1000;
 try {
  db.exec(`PRAGMA journal_mode=WAL;PRAGMA busy_timeout=5000;
    CREATE TABLE progression_xp_ledger(id TEXT PRIMARY KEY,steam_id TEXT,amount INTEGER,source TEXT,reference_type TEXT,created_at TEXT);
    CREATE TABLE progression_xp_source_times(ledger_id TEXT PRIMARY KEY,source_at INTEGER,basis TEXT);`);
  const store=createSeasonTrackStore(db,{now:()=>clock}),def={id:'synthetic-collector-race',title:'Synthetic collector race',startsAt:iso(START),endsAt:iso(START+86400000),settlesAt:iso(START+2*86400000),retainUntil:iso(START+30*86400000),free:true,sources:[{source:'quest',policy:'achievement-time'}],tiers:[{xp:10,title:'Synthetic milestone'}]},digest=describe(def).digest;
  store.stage(def,{reviewer:A,digest});store.changeState(def.id,{reviewer:A,digest,action:'publish',expectedRevision:1});clock=START;store.enroll(def.id,A);store.enroll(def.id,B);
  for(const actor of [A,B])for(let i=0;i<3;i++){const id=actor+'-'+i;db.prepare("INSERT INTO progression_xp_ledger VALUES(?,?,10,'quest','quest',?)").run(id,actor,iso(START));db.prepare("INSERT INTO progression_xp_source_times VALUES(?,?,'quest-achievement')").run(id,START);}
  async function race(){const workers=await Promise.all([0,1].map(async()=>{const child=await startWorker({file,module:require.resolve('../src/services/seasonTrackStore'),now:START});children.push(child);return child;}));workers.forEach(w=>w.go());const results=await Promise.all(workers.map(w=>w.result));await Promise.all(workers.map(w=>w.exit));assert.ok(results.every(r=>!r.error),JSON.stringify(results));assert.equal(results.reduce((n,r)=>n+r.result.accepted,0),2);}
  await race();assert.equal(store.progress(def.id,A).xp,10);assert.equal(store.progress(def.id,B).xp,10);
  db.exec('VACUUM');await race();assert.equal(store.progress(def.id,A).xp,20);assert.equal(store.progress(def.id,B).xp,20);
  await race();assert.equal(store.progress(def.id,A).xp,30);assert.equal(store.progress(def.id,B).xp,30);
  assert.equal(store.collect().accepted,0);assert.equal(db.prepare('SELECT count(*) n FROM progression_season_evidence').get().n,6);
 }finally{await Promise.all(children.map(w=>w.stop()));db.close();fs.rmSync(directory,{recursive:true,force:true});}
});
