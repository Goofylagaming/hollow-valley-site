"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite'),{randomUUID}=require('node:crypto');
const A={id:1,steam_id:'76561198000000001'},B={id:2,steam_id:'76561198000000002'},C={id:3,steam_id:'76561198000000003'};
function fixture(db){db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,steam_id TEXT,is_admin INTEGER);INSERT INTO users VALUES(1,'76561198000000001',1),(2,'76561198000000002',0),(3,'76561198000000003',0);CREATE TABLE wallets(user_id INTEGER,balance INTEGER);INSERT INTO wallets VALUES(1,500)");let clock=Date.parse('2026-11-05T09:00:00+10:00'),enabled=true;
 const templates=require('../server/services/eventTemplateStore').createEventTemplateStore(db,{now:()=>clock}),schedules=require('../server/services/eventScheduleStore').createEventScheduleStore(db,{now:()=>clock}),store=require('../server/services/eventRegistrationStore').createEventRegistrationStore(db,{now:()=>clock,enabled:()=>enabled});
 const template=templates.change(A,{id:randomUUID(),expectedRevision:0,requestKey:randomUUID(),action:'save',details:{kind:'fight-night',title:'Valley Fight Night',description:'A planned event with verified staff.',rules:'Follow the published staff event rules.',durationMinutes:60,capacity:2,teamCount:1}}).current;
 const eventId=randomUUID();schedules.change(A,{eventId,expectedRevision:0,requestKey:randomUUID(),action:'create',templateId:template.id,templateRevision:1,startsAt:clock+3600000});schedules.change(A,{eventId,expectedRevision:1,requestKey:randomUUID(),action:'publish',reason:'Staff reviewed this website event.'});
 return {db,templates,schedules,store,eventId,clock:()=>clock,advance:n=>clock+=n,pause:()=>enabled=false,resume:()=>enabled=true,choice:(selected=true,expectedRevision=0,eventRevision=2)=>({eventId,selected,expectedRevision,requestKey:randomUUID(),...(selected?{eventRevision}:{})})};
}
function setup(t){const db=new DatabaseSync(':memory:');t.after(()=>db.close());return fixture(db);}
test('linked-player signup reserves capacity once; full events never create silent waitlist or attendance/rewards',t=>{
 const x=setup(t),join=x.choice();const result=x.store.change(A,join);assert.equal(result.current.state,'registered');assert.equal(result.current.reservedPlaces,1);assert.equal(x.store.change(A,join).duplicate,true);x.store.change(B,x.choice());assert.equal(x.store.current(C,x.eventId).placesAvailable,0);assert.throws(()=>x.store.change(C,x.choice()),{status:409});
 assert.equal(x.db.prepare('SELECT count(*) n FROM hv_event_registration_history').get().n,2);assert.equal(x.db.prepare('SELECT balance FROM wallets').get().balance,500);assert.equal(result.current.attendanceConfirmed,false);assert.equal(result.current.rewardsEnabled,false);assert.equal(JSON.stringify(result).includes(A.steam_id),false);
});
test('rescheduling requires explicit reconfirmation but retains reserved places and the originally accepted times',t=>{
 const x=setup(t),original=x.choice();x.store.change(A,original);x.store.change(B,x.choice());const old=x.store.current(A,x.eventId).acceptedEvent.startsAt;
 x.schedules.change(A,{eventId:x.eventId,expectedRevision:2,requestKey:randomUUID(),action:'reschedule',startsAt:old+3600000,reason:'Staff moved this planned event later.'});
 const changed=x.store.current(A,x.eventId);assert.equal(changed.state,'review-new-time');assert.equal(changed.acceptedEvent.startsAt,old);assert.equal(changed.event.startsAt,old+3600000);assert.equal(changed.reservedPlaces,2);assert.throws(()=>x.store.change(C,x.choice(true,0,3)),{status:409});
 assert.equal(x.store.change(A,original).current.state,'review-new-time');assert.throws(()=>x.store.change(A,x.choice(true,1,2)),{status:409});
 const accepted=x.store.change(A,x.choice(true,1,3));assert.equal(accepted.current.state,'registered');assert.equal(accepted.current.revision,2);assert.equal(accepted.current.reservedPlaces,2);assert.equal(x.store.history(A,x.eventId).items.length,2);
});
test('withdrawal remains available when paused, cancelled or past start and old retries cannot change a later choice',t=>{
 const x=setup(t),join=x.choice();x.store.change(A,join);const leave=x.choice(false,1);x.store.change(A,leave);x.store.change(A,x.choice(true,2));assert.equal(x.store.change(A,leave).current.selected,true);
 x.pause();assert.throws(()=>x.store.change(B,x.choice()),{status:503});assert.equal(x.store.change(A,join).duplicate,true);x.advance(7200000);
 x.schedules.change(A,{eventId:x.eventId,expectedRevision:2,requestKey:randomUUID(),action:'cancel',reason:'Cancelled the website listing after review.'});assert.equal(x.store.current(A,x.eventId).state,'event-cancelled');const stop=x.choice(false,3);assert.equal(x.store.change(A,stop).current.selected,false);assert.equal(x.store.change(A,stop).duplicate,true);assert.equal(x.store.mine(A).items[0].state,'withdrawn');
});
test('unknown drafts are private and current Steam identity scopes reads, histories and every receipt',t=>{
 const x=setup(t),join=x.choice();x.store.change(A,join);assert.deepEqual(x.store.mine(B).items,[]);assert.throws(()=>x.store.history(B,x.eventId),{status:404});assert.throws(()=>x.store.current({...A,steam_id:B.steam_id},x.eventId),{status:403});assert.throws(()=>x.store.mine(null),{status:401});
 assert.throws(()=>x.store.change(A,{...x.choice(),steamId:B.steam_id}),{status:400});x.db.exec("UPDATE users SET steam_id='76561198000000999' WHERE id=1");assert.throws(()=>x.store.change(A,join),{status:403});assert.throws(()=>x.store.current(B,randomUUID()),{status:404});
});
test('failed signup/withdrawal history and receipts roll back the seat, choice and counts together',t=>{
 const x=setup(t),join=x.choice();x.db.exec("CREATE TRIGGER refuse_signup BEFORE INSERT ON hv_event_registration_history BEGIN SELECT RAISE(ABORT,'history unavailable'); END");assert.throws(()=>x.store.change(A,join),/history unavailable/);assert.equal(x.store.current(A,x.eventId).reservedPlaces,0);assert.equal(x.store.current(A,x.eventId).revision,0);x.db.exec('DROP TRIGGER refuse_signup');x.store.change(A,join);
 x.db.exec("CREATE TRIGGER refuse_leave BEFORE INSERT ON hv_event_registration_requests BEGIN SELECT RAISE(ABORT,'receipt unavailable'); END");assert.throws(()=>x.store.change(A,x.choice(false,1)),/receipt unavailable/);assert.equal(x.store.current(A,x.eventId).selected,true);assert.equal(x.store.current(A,x.eventId).revision,1);assert.equal(x.store.history(A,x.eventId).items.length,1);
});
test('stale choices, request conflicts, start boundary and paused unknown events fail without new receipts',t=>{
 const x=setup(t),join=x.choice();x.store.change(A,join);assert.throws(()=>x.store.change(A,{...join,eventRevision:3}),{status:409});assert.throws(()=>x.store.change(A,x.choice(false,0)),{status:409});
 x.advance(3600000);assert.throws(()=>x.store.change(B,x.choice()),{status:409});assert.equal(x.store.change(A,join).duplicate,true);assert.equal(x.store.change(A,x.choice(false,1)).current.selected,false);x.pause();assert.throws(()=>x.store.current(B,x.eventId),{status:404});assert.equal(x.store.current(A,x.eventId).selected,false);
});
test('rate limiting permits exact receipt recovery and an actual withdrawal',t=>{
 const x=setup(t),join=x.choice();x.store.change(A,join);for(let n=1;n<20;n++)x.store.change(A,x.choice(true,n));assert.throws(()=>x.store.change(A,x.choice(true,20)),{status:429});assert.equal(x.store.change(A,join).duplicate,true);assert.equal(x.store.change(A,x.choice(false,20)).current.selected,false);assert.throws(()=>x.store.change(A,x.choice(false,21)),{status:429});
});
test('private pages remain bounded and a missing schedule never prevents withdrawing a saved registration',t=>{
 const x=setup(t),templateId=x.schedules.read(A,x.eventId).templateId;
 for(let n=0;n<27;n++){if(n%12===0)x.advance(60001);const id=randomUUID();x.schedules.change(A,{eventId:id,expectedRevision:0,requestKey:randomUUID(),action:'create',templateId,templateRevision:1,startsAt:x.clock()+3600000});x.schedules.change(A,{eventId:id,expectedRevision:1,requestKey:randomUUID(),action:'publish',reason:'Reviewed another planned event listing.'});x.store.change(A,{...x.choice(),eventId:id});}
 const first=x.store.mine(A),second=x.store.mine(A,{before:first.next});assert.equal(first.items.length,25);assert.equal(second.items.length,2);assert.equal(new Set([...first.items,...second.items].map(r=>r.event.id)).size,27);
 const id=first.items[0].event.id;for(let n=1;n<=26;n++){if(n%10===0||n===1)x.advance(60001);x.store.change(A,{...x.choice(true,n),eventId:id});}
 const history=x.store.history(A,id),earlier=x.store.history(A,id,{before:history.next});assert.equal(history.items.length,25);assert.equal(earlier.items.length,2);
 x.db.prepare('DELETE FROM hv_event_schedules WHERE id=?').run(id);assert.equal(x.store.current(A,id).state,'unavailable');assert.equal(x.store.change(A,{...x.choice(false,27),eventId:id}).current.state,'withdrawn');
});

test('independent SQLite workers competing for the last place cannot oversubscribe capacity',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'hv-event-seats-')),file=path.join(temp,'events.sqlite'),db=new DatabaseSync(file);db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
 try{
  const x=fixture(db);x.store.change(A,x.choice());
  const script=`const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1]);db.exec('PRAGMA busy_timeout=5000');const s=require('./server/services/eventRegistrationStore').createEventRegistrationStore(db,{now:()=>Number(process.argv[2])});try{const result=s.change(JSON.parse(process.argv[3]),JSON.parse(process.argv[4]));process.stdout.write(JSON.stringify({ok:true,revision:result.current.revision}));}catch(e){process.stdout.write(JSON.stringify({ok:false,status:e.status}));}finally{db.close();}`;
  const work=user=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,['-e',script,file,String(x.clock()),JSON.stringify(user),JSON.stringify(x.choice())],{cwd:path.join(__dirname,'..'),windowsHide:true});let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.on('error',reject);child.on('close',code=>{if(code)reject(new Error(stderr));else{try{resolve(JSON.parse(stdout));}catch(e){reject(e);}}});});
  const results=await Promise.all([work(B),work(C)]);assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.find(r=>!r.ok).status,409);assert.equal(x.store.current(A,x.eventId).reservedPlaces,2);assert.equal(db.prepare('SELECT count(*) n FROM hv_event_registration_history').get().n,2);
 }finally{db.close();const target=path.resolve(temp),root=path.resolve(os.tmpdir())+path.sep;if(!target.startsWith(root))throw new Error('Unexpected temporary cleanup target');fs.rmSync(target,{recursive:true,force:true});}
});
