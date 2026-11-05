"use strict";
const MAX_AGE_MS=90000;
const TASK_STATES=Object.freeze(['Running','Ready','Disabled','Queued','Unknown','Missing']);
function sourceTime(value){
 if(typeof value!=='string')return null;
 const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?Z$/.exec(value);if(!match)return null;
 const [year,month,day,hour,minute,second]=match.slice(1,7).map(Number);
 if(year<1970||month<1||month>12||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate()||hour>23||minute>59||second>59)return null;
 const at=Date.UTC(year,month-1,day,hour,minute,second,Number((match[7]||'').padEnd(3,'0').slice(0,3)));
 return Number.isSafeInteger(at)&&at>=0?at:null;
}
const base=code=>({id:'bridge-worker',scope:'windows-scheduled-task',code,observedAt:null,executionVerified:false});
function createBridgeWorkerHealthStore(db,{initialize=true,now=Date.now}={}){
 if(initialize)db.exec(`CREATE TABLE IF NOT EXISTS hv_bridge_worker_observation(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL,observed_at INTEGER NOT NULL,received_at INTEGER NOT NULL,task_state TEXT NOT NULL)`);
 function record(raw){
  const observedAt=sourceTime(raw?.sampledAt),task=raw?.tasks?.command_bridge,at=now();
  if(observedAt===null||!TASK_STATES.includes(task)||!Number.isSafeInteger(at)||at<0||observedAt>at+120000)return {accepted:false,reason:'unsupported-observation'};
  db.exec('SAVEPOINT bridge_worker_observation');try{
   const old=db.prepare('SELECT * FROM hv_bridge_worker_observation WHERE id=1').get();
   if(old&&observedAt<=old.observed_at){db.exec('RELEASE bridge_worker_observation');return {accepted:false,reason:observedAt===old.observed_at&&task===old.task_state?'duplicate':'stale-or-conflicting'};}
   db.prepare('INSERT INTO hv_bridge_worker_observation VALUES(1,1,?,?,?) ON CONFLICT(id) DO UPDATE SET version=1,observed_at=excluded.observed_at,received_at=excluded.received_at,task_state=excluded.task_state').run(observedAt,at,task);
   db.exec('RELEASE bridge_worker_observation');return {accepted:true};
  }catch(e){db.exec('ROLLBACK TO bridge_worker_observation;RELEASE bridge_worker_observation');throw e;}
 }
 function read(){
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='hv_bridge_worker_observation'").get())return base('no-observation');
  const row=db.prepare('SELECT version,observed_at,received_at,task_state FROM hv_bridge_worker_observation WHERE id=1').get(),at=now();
  if(!row)return base('no-observation');
  if(row.version!==1||![row.observed_at,row.received_at,at].every(n=>Number.isSafeInteger(n)&&n>=0)||!TASK_STATES.includes(row.task_state)||row.observed_at>row.received_at+120000)return base('unavailable');
  if(row.observed_at>at||row.received_at>at)return base('unverified-clock');
  const value={...base(''),observedAt:new Date(row.observed_at).toISOString()};
  if(at-row.observed_at>MAX_AGE_MS||at-row.received_at>MAX_AGE_MS)return {...value,code:'stale'};
  return {...value,code:row.task_state==='Running'?'running':row.task_state==='Queued'?'queued':row.task_state==='Unknown'?'unknown-state':'not-running'};
 }
 return {record,read};
}
function captureManagementObservation(raw,{db,env=process.env,now=Date.now}={}){
 if(env.STATUS_COMPONENTS_COLLECTION_ENABLED!=='1')return {accepted:false,reason:'disabled'};
 // Unsupported old senders do not initialize a table or invent a source clock.
 if(sourceTime(raw?.sampledAt)===null||!TASK_STATES.includes(raw?.tasks?.command_bridge))return {accepted:false,reason:'unsupported-observation'};
 return createBridgeWorkerHealthStore(db||require('../db').db,{now}).record(raw);
}
module.exports={MAX_AGE_MS,sourceTime,createBridgeWorkerHealthStore,captureManagementObservation};
