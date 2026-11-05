"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite'),{randomUUID}=require('node:crypto');
const {createStatusIncidentStore}=require('../server/services/statusIncidentStore');
const GUILD='111122223333444455',AT=Date.parse('2026-11-06T01:00:00Z');
function fixture(t){const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,steam_id TEXT,is_admin INTEGER);INSERT INTO users VALUES(1,'76561198000000001',1),(2,'76561198000000002',1),(3,'76561198000000003',0)");
 let paused=false,readOnly=false;const admin={id:1,steam_id:'76561198000000001'},other={id:2,steam_id:'76561198000000002'},user={id:3,steam_id:'76561198000000003'};
 const store=createStatusIncidentStore(db,{now:()=>AT,guild:()=>GUILD,writable:action=>{if(readOnly)throw Object.assign(new Error('Read only'),{status:403});if(paused&&action!=='withdraw')throw Object.assign(new Error('Paused'),{status:503});}}),id=randomUUID();
 const details={components:['game','bridge'],severity:'outage',status:'investigating',title:'Game connections interrupted',summary:'Staff are investigating reported connection interruptions.',startedAt:AT-60000,endedAt:null,verifiedAt:AT-1000,evidenceUrls:[`https://discord.com/channels/${GUILD}/222233334444555566/333344445555666677`],evidenceNote:'Private source explanation, not for public release.'};
 const change=(action,expectedRevision,extra={},actor=admin)=>store.change(actor,{id,action,expectedRevision,requestKey:randomUUID(),reason:'Reviewed local fixture',...extra});
 return {db,store,id,details,admin,other,user,change,pause:()=>{paused=true;},readOnly:()=>{readOnly=true;}};
}
test('saving and publishing are separate exact reviews; later draft edits stay private, corrections replace public text and withdrawal is audited',t=>{
 const f=fixture(t);f.change('save',0,{details:f.details});assert.equal(f.store.publicList().items.length,0);const review=f.store.read(f.admin,f.id);
 assert.throws(()=>f.change('publish',1,{reviewDigest:'0'.repeat(64)}),{status:409});f.change('publish',1,{reviewDigest:review.reviewDigest});const first=f.store.publicList();assert.equal(first.items[0].source,'staff-reviewed');assert.equal(first.independentMonitoring,false);
 assert.doesNotMatch(JSON.stringify(first),/76561198|evidenceUrls|Private source|discord\.com|evidenceGuild|actor/);
 f.change('save',2,{details:{...f.details,status:'monitoring',summary:'Service has recovered and staff are watching for recurrence.'}});assert.equal(f.store.publicList().items[0].status,'investigating');
 f.change('publish',3,{reviewDigest:f.store.read(f.admin,f.id).reviewDigest});assert.equal(f.store.publicList().items[0].status,'monitoring');
 f.pause();f.change('withdraw',4);assert.equal(f.store.publicList().items.length,0);assert.equal(f.store.history(f.admin,f.id).items.length,5);assert.throws(()=>f.change('save',5,{details:f.details}),{status:503});
});
test('lost replies retain one result; conflicting requests, stale reviews and changed staff binding cannot mutate later state',t=>{
 const f=fixture(t),request={id:f.id,action:'save',expectedRevision:0,requestKey:randomUUID(),reason:'Original review',details:f.details};
 const first=f.store.change(f.admin,request);assert.equal(f.store.change(f.admin,request).duplicate,true);assert.throws(()=>f.store.change(f.admin,{...request,reason:'Changed review'}),{status:409});
 f.change('save',1,{details:{...f.details,title:'Updated public draft'}},f.other);const retry=f.store.change(f.admin,request);assert.deepEqual(retry.saved,first.saved);assert.equal(retry.current.revision,2);
 assert.throws(()=>f.change('publish',1,{reviewDigest:first.current.reviewDigest}),{status:409});
 f.db.prepare('UPDATE users SET is_admin=0 WHERE id=1').run();assert.throws(()=>f.store.change(f.admin,request),{status:403});assert.throws(()=>f.store.read(f.admin,f.id),{status:403});
 assert.throws(()=>f.store.list(f.user),{status:403});assert.throws(()=>f.store.list(null),{status:401});
});
test('public claims require bounded public fields, correct official evidence and coherent recorded times',t=>{
 const f=fixture(t);for(const patch of [{components:['unknown']},{components:['game','game']},{severity:'healthy'},{status:'offline'},{verifiedAt:AT+1},{endedAt:AT},{status:'resolved',endedAt:null},{summary:'Player 76561198000000001 experienced trouble'},{summary:'Server 127.0.0.1 needs repair'},{summary:'Read https://private.example for proof'},{evidenceUrls:[`https://discord.com/channels/999922223333444455/222233334444555566/333344445555666677`]},{evidenceUrls:[f.details.evidenceUrls[0]+'?token=private']},{evidenceUrls:[]},{extra:'ignored'}])assert.throws(()=>f.change('save',0,{details:{...f.details,...patch}}));
 f.change('save',0,{details:{...f.details,status:'resolved',endedAt:AT-2000}});assert.equal(f.store.read(f.admin,f.id).draft.status,'resolved');
});
test('evidence and audit failures hide untrusted publications and transaction failure rolls back the draft and receipt',t=>{
 const f=fixture(t);f.db.exec("CREATE TRIGGER refuse_status_history BEFORE INSERT ON hv_status_incident_history BEGIN SELECT RAISE(ABORT,'history unavailable');END");
 assert.throws(()=>f.change('save',0,{details:f.details}),/history unavailable/);assert.equal(f.db.prepare('SELECT count(*) n FROM hv_status_incidents').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM hv_status_incident_requests').get().n,0);
 f.db.exec('DROP TRIGGER refuse_status_history');f.change('save',0,{details:f.details});f.change('publish',1,{reviewDigest:f.store.read(f.admin,f.id).reviewDigest});
 f.db.exec("UPDATE hv_status_incident_history SET draft_json='{}' WHERE revision=1");assert.equal(f.store.publicList().items.length,1,'publication binds its own saved review');
 f.db.exec("UPDATE hv_status_incident_history SET draft_json='{}' WHERE revision=2");const hidden=f.store.publicList();assert.equal(hidden.items.length,0);assert.equal(hidden.partial,true);
});
test('read-only guards and exact page boundaries preserve history and never infer healthy components from an empty list',t=>{
 const f=fixture(t);assert.deepEqual(f.store.publicList(),{items:[],next:null,partial:false,source:'staff-reviewed',independentMonitoring:false});f.change('save',0,{details:f.details});f.readOnly();assert.throws(()=>f.change('publish',1,{reviewDigest:f.store.read(f.admin,f.id).reviewDigest}),{status:403});
 for(const before of [0,-1,1.5,'1'])assert.throws(()=>f.store.publicList({before}));assert.equal(f.store.publicList({before:1}).items.length,0);
});
test('changing the official evidence server requires a new save/review before publication while existing reports retain their original proof',t=>{
 const f=fixture(t);f.change('save',0,{details:f.details});const review=f.store.read(f.admin,f.id),other=createStatusIncidentStore(f.db,{now:()=>AT,guild:()=>'999922223333444455'});
 const publish=()=>other.change(f.admin,{id:f.id,action:'publish',expectedRevision:1,requestKey:randomUUID(),reason:'Reviewed changed source policy',reviewDigest:review.reviewDigest});
 assert.throws(publish,{status:409});f.change('publish',1,{reviewDigest:review.reviewDigest});assert.equal(other.publicList().items.length,1,'old publications bind their frozen source policy');
 other.change(f.admin,{id:f.id,action:'withdraw',expectedRevision:2,requestKey:randomUUID(),reason:'Withdraw while source policy changed'});assert.equal(other.publicList().items.length,0);
 assert.throws(()=>other.change(f.admin,{id:f.id,action:'publish',expectedRevision:3,requestKey:randomUUID(),reason:'Review old evidence again',reviewDigest:review.reviewDigest}),{status:409});
});
