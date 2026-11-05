"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite'),{randomUUID}=require('node:crypto');
const {createEventScheduleStore}=require('../server/services/eventScheduleStore'),{createEventTemplateStore}=require('../server/services/eventTemplateStore');
const A={id:1,steam_id:'76561198000000001'},B={id:2,steam_id:'76561198000000002'};
function setup(t){const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,steam_id TEXT,is_admin INTEGER);INSERT INTO users VALUES(1,'76561198000000001',1),(2,'76561198000000002',1);CREATE TABLE wallets(user_id INTEGER,balance INTEGER);INSERT INTO wallets VALUES(1,1000)");let at=Date.parse('2026-11-05T00:00:00+10:00');const templates=createEventTemplateStore(db,{now:()=>at}),store=createEventScheduleStore(db,{now:()=>at});const template=templates.change(A,{id:randomUUID(),expectedRevision:0,requestKey:randomUUID(),action:'save',details:{kind:'migration',title:'Valley Migration',description:'Follow a planned route with staff.',rules:'Follow the staff route and server rules.',durationMinutes:90,capacity:50,teamCount:1}}).current;
 return {db,templates,store,template,now:()=>at,advance:n=>at+=n,create:(patch={})=>({eventId:randomUUID(),expectedRevision:0,requestKey:randomUUID(),action:'create',templateId:template.id,templateRevision:1,startsAt:at+3600000,...patch}),act:(eventId,expectedRevision,action,patch={})=>({eventId,expectedRevision,requestKey:randomUUID(),action,reason:'Staff reviewed this website schedule.',...patch})};}
test('event draft freezes reviewed template rules and remains private until explicit schedule publication',t=>{
 const x=setup(t),request=x.create(),event=x.store.change(A,request).current;assert.equal(event.state,'draft');assert.equal(event.endsAt,event.startsAt+90*60000);assert.equal(x.store.published().events.length,0);
 x.templates.change(B,{id:x.template.id,expectedRevision:1,requestKey:randomUUID(),action:'save',details:{...x.template.definition,title:'Changed later',durationMinutes:30}});
 assert.equal(x.store.read(A,event.id).definition.title,'Valley Migration');assert.throws(()=>x.store.change(A,x.create()),{status:409});
 x.templates.change(B,{id:x.template.id,expectedRevision:2,requestKey:randomUUID(),action:'archive'});
 const published=x.store.change(A,x.act(event.id,1,'publish')).current;assert.equal(published.state,'scheduled');assert.equal(published.templateRevision,1);assert.equal(published.endsAt,event.endsAt);
 const publicEvent=x.store.published().events[0];assert.equal(publicEvent.title,'Valley Migration');for(const field of ['actorSteamId','templateId','templateRevision','reason','definition'])assert.equal(Object.hasOwn(publicEvent,field),false);
 assert.equal(x.db.prepare('SELECT balance FROM wallets').get().balance,1000);
});
test('reschedules and cancellation preserve old times, rules and immutable receipts after later edits',t=>{
 const x=setup(t),creation=x.create(),event=x.store.change(A,creation).current,publish=x.act(event.id,1,'publish');x.store.change(A,publish);
 const reschedule=x.act(event.id,2,'reschedule',{startsAt:event.startsAt+3600000});x.store.change(B,reschedule);
 const recovered=x.store.change(A,publish);assert.equal(recovered.duplicate,true);assert.equal(recovered.saved.startsAt,event.startsAt);assert.equal(recovered.current.startsAt,event.startsAt+3600000);
 assert.throws(()=>x.store.change(A,{...reschedule,requestKey:randomUUID()}),{status:409});assert.throws(()=>x.store.change(A,{...publish,reason:'Different staff intent recorded.'}),{status:409});
 const cancel=x.act(event.id,3,'cancel');x.store.change(A,cancel);assert.equal(x.store.published().events.length,0);assert.equal(x.store.change(A,publish).current.state,'cancelled');assert.equal(x.store.change(A,cancel).duplicate,true);
 assert.throws(()=>x.store.change(A,x.act(event.id,4,'reschedule',{startsAt:event.startsAt+7200000})),{status:409});
 const history=x.store.history(A,event.id).items;assert.equal(history.length,4);assert.equal(history.at(-1).schedule.startsAt,event.startsAt);assert.equal(history[1].schedule.startsAt,event.startsAt+3600000);
});
test('elapsed planned times never imply live/completed and fresh publication cannot start in the past',t=>{
 const x=setup(t),request=x.create(),event=x.store.change(A,request).current;x.advance(3600001);
 assert.throws(()=>x.store.change(A,x.act(event.id,1,'publish')),{status:409});assert.equal(x.store.change(A,request).duplicate,true);
 const next=x.create(),other=x.store.change(A,next).current,publish=x.act(other.id,1,'publish');x.store.change(A,publish);x.advance(3600001);
 assert.equal(x.store.read(A,other.id).state,'scheduled');assert.equal(x.store.published().events[0].state,'scheduled');assert.throws(()=>x.store.change(A,x.act(other.id,2,'reschedule',{startsAt:x.now()+3600000})),{status:409});
 x.advance(3*86400000);assert.equal(x.store.published().events.length,0);assert.equal(x.store.read(A,other.id).state,'scheduled');assert.equal(x.store.change(A,publish).duplicate,true);
});
test('schedule audit/receipt failure rolls back publication, cancellation and public calendar together',t=>{
 const x=setup(t),event=x.store.change(A,x.create()).current;
 x.db.exec("CREATE TRIGGER block_schedule_history BEFORE INSERT ON hv_event_schedule_history BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");const publish=x.act(event.id,1,'publish');assert.throws(()=>x.store.change(A,publish),/audit unavailable/);assert.equal(x.store.read(A,event.id).revision,1);assert.equal(x.store.published().events.length,0);
 x.db.exec('DROP TRIGGER block_schedule_history');x.store.change(A,publish);
 x.db.exec("CREATE TRIGGER block_schedule_receipt BEFORE INSERT ON hv_event_schedule_requests BEGIN SELECT RAISE(ABORT,'receipt unavailable'); END");assert.throws(()=>x.store.change(A,x.act(event.id,2,'cancel')),/receipt unavailable/);assert.equal(x.store.read(A,event.id).state,'scheduled');assert.equal(x.store.history(A,event.id).items.length,2);assert.equal(x.store.published().events.length,1);
});
test('malformed schedules, caller definitions, unknown lifecycle and stale source versions cannot create events',t=>{
 const x=setup(t);for(const patch of [{startsAt:NaN},{startsAt:x.now()},{startsAt:x.now()+367*86400000},{startsAt:'2026-11-06'},{templateRevision:0},{templateRevision:2},{definition:x.template.definition},{action:'complete'},{expectedRevision:1}])assert.throws(()=>x.store.change(A,x.create(patch)));
 assert.equal(x.store.list(A).items.length,0);assert.equal(x.store.published().events.length,0);
});
test('current staff access is required for private histories and retry recovery',t=>{
 const x=setup(t),request=x.create();x.store.change(A,request);x.db.exec('UPDATE users SET is_admin=0 WHERE id=1');for(const work of [()=>x.store.list(A),()=>x.store.read(A,request.eventId),()=>x.store.history(A,request.eventId),()=>x.store.change(A,request)])assert.throws(work,{status:403});assert.throws(()=>x.store.list(null),{status:401});assert.equal(x.store.read(B,request.eventId).revision,1);
});
test('calendar and staff lists have bounded stable pages with same-time event tie breakers',t=>{
 const x=setup(t);for(let n=0;n<27;n++){if(n===14)x.advance(60001);const r=x.create({startsAt:x.now()+86400000});x.store.change(A,r);x.store.change(A,x.act(r.eventId,1,'publish'));}
 const first=x.store.published(),second=x.store.published({after:first.next});assert.equal(first.events.length,25);assert.equal(second.events.length,2);assert.equal(new Set([...first.events,...second.events].map(e=>e.id)).size,27);
 const list=x.store.list(A),next=x.store.list(A,{before:list.next});assert.equal(list.items.length,25);assert.equal(next.items.length,2);assert.throws(()=>x.store.published({after:{startsAt:NaN,id:randomUUID()}}),{status:400});
});
