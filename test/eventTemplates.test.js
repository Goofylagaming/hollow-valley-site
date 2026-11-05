"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite'),{randomUUID}=require('node:crypto');
const {createEventTemplateStore,KINDS}=require('../server/services/eventTemplateStore');
const A={id:1,steam_id:'76561198000000001'},B={id:2,steam_id:'76561198000000002'};
const details=kind=>({kind:kind||'fight-night',title:'Friday Fight Night',description:'Staff-planned community event.',rules:'Follow staff directions and the server rules.',durationMinutes:60,capacity:32,teamCount:2});
function setup(t){const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY,steam_id TEXT,is_admin INTEGER); CREATE TABLE wallets(user_id INTEGER,balance INTEGER);INSERT INTO wallets VALUES (1,1200)');for(const user of [A,B])db.prepare('INSERT INTO users VALUES (?,?,1)').run(user.id,user.steam_id);let at=100000;const store=createEventTemplateStore(db,{now:()=>at});return {db,store,advance:()=>at+=60001,save:(id=randomUUID(),expectedRevision=0,kind)=>({id,expectedRevision,requestKey:randomUUID(),action:'save',details:details(kind)})};}
test('all eight event types have staff-only drafts, immutable history and no wallet effects',t=>{
 const x=setup(t);assert.equal(Object.keys(KINDS).length,8);
 for(const kind of Object.keys(KINDS)){const request=x.save(undefined,0,kind),result=x.store.change(A,request);assert.equal(result.current.state,'draft');assert.equal(result.current.definition.kind,kind);assert.equal(x.store.history(B,request.id).items[0].actorSteamId,A.steam_id);}
 assert.equal(x.store.list(A).items.length,8);assert.equal(x.db.prepare('SELECT balance FROM wallets').get().balance,1200);
 assert.equal(x.db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name LIKE '%outbox%'").get().n,0);
 const reopened=createEventTemplateStore(x.db);assert.equal(reopened.list(A).items.length,8);
});
test('two staff editors cannot overwrite one revision and a lost reply recovers without repeating effects',t=>{
 const x=setup(t),request=x.save();x.store.change(A,request);
 const edit={...request,expectedRevision:1,requestKey:randomUUID(),details:{...request.details,title:'Reviewed title'}};x.store.change(B,edit);
 assert.throws(()=>x.store.change(A,{...edit,requestKey:randomUUID()}),{status:409});
 const retry=x.store.change(A,request);assert.equal(retry.duplicate,true);assert.equal(retry.saved.revision,1);assert.equal(retry.current.revision,2);assert.equal(retry.current.definition.title,'Reviewed title');
 assert.throws(()=>x.store.change(A,{...request,details:{...request.details,capacity:16}}),{status:409});
 assert.equal(x.store.history(A,request.id).items.length,2);
});
test('archive retains exact rules and history, hides from active pages and cannot be edited or revived by retries',t=>{
 const x=setup(t),request=x.save();x.store.change(A,request);
 const archive={id:request.id,action:'archive',expectedRevision:1,requestKey:randomUUID()};const result=x.store.change(B,archive);
 assert.equal(result.current.state,'archived');assert.deepEqual(result.current.definition,request.details);assert.equal(x.store.list(A).items.length,0);assert.equal(x.store.list(A,{includeArchived:true}).items.length,1);
 assert.equal(x.store.change(A,request).current.state,'archived');assert.equal(x.store.change(B,archive).duplicate,true);
 assert.throws(()=>x.store.change(A,{...request,expectedRevision:2,requestKey:randomUUID()}),{status:409});
 assert.throws(()=>x.store.change(A,{...archive,expectedRevision:2,details:request.details}),{status:400});
 assert.equal(x.store.history(A,request.id).items.length,2);
});
test('current database permissions bind reads, history, edits and even duplicate receipts',t=>{
 const x=setup(t),request=x.save();x.store.change(A,request);
 assert.throws(()=>x.store.list(null),{status:401});assert.throws(()=>x.store.list({...A,steam_id:B.steam_id}),{status:403});
 x.db.exec('UPDATE users SET is_admin=0 WHERE id=1');
 for(const work of [()=>x.store.list(A),()=>x.store.read(A,request.id),()=>x.store.history(A,request.id),()=>x.store.change(A,request)])assert.throws(work,{status:403});
 assert.equal(x.store.read(B,request.id).revision,1);
});
test('audit or receipt failure rolls back creation, revision and archive together',t=>{
 const x=setup(t),request=x.save();x.db.exec("CREATE TRIGGER refuse_history BEFORE INSERT ON hv_event_template_history BEGIN SELECT RAISE(ABORT,'history failed'); END");
 assert.throws(()=>x.store.change(A,request),/history failed/);assert.equal(x.store.list(A).items.length,0);assert.equal(x.db.prepare('SELECT count(*) n FROM hv_event_template_requests').get().n,0);
 x.db.exec('DROP TRIGGER refuse_history');x.store.change(A,request);
 x.db.exec("CREATE TRIGGER refuse_receipt BEFORE INSERT ON hv_event_template_requests BEGIN SELECT RAISE(ABORT,'receipt failed'); END");
 assert.throws(()=>x.store.change(A,{id:request.id,action:'archive',expectedRevision:1,requestKey:randomUUID()}),/receipt failed/);
 assert.equal(x.store.read(A,request.id).revision,1);assert.equal(x.store.read(A,request.id).state,'draft');assert.equal(x.store.history(A,request.id).items.length,1);
});
test('template validation rejects malformed limits, unsupported automation fields and invalid actions',t=>{
 const x=setup(t);
 for(const patch of [{kind:'__proto__'},{kind:['migration']},{title:'ab'},{description:'short'},{rules:'\u0000invalid rules'},{durationMinutes:4},{durationMinutes:1.5},{capacity:501},{capacity:2,teamCount:3},{teamCount:0},{rewardCoins:500},{gameCommand:'grow'},{capacity:true}])assert.throws(()=>x.store.change(A,{...x.save(),details:{...details(),...patch}}),{status:400});
 assert.throws(()=>x.store.change(A,{...x.save(),action:'publish'}),{status:400});assert.equal(x.store.list(A).items.length,0);
});
test('bounded list and history pagination have no duplicates and write limits preserve exact retries',t=>{
 const x=setup(t),requests=[];for(let n=0;n<27;n++){const r=x.save();requests.push(r);x.store.change(A,r);}
 const first=x.store.list(A),second=x.store.list(A,{before:first.next});assert.equal(first.items.length,25);assert.equal(second.items.length,2);assert.equal(new Set([...first.items,...second.items].map(r=>r.id)).size,27);
 assert.throws(()=>x.store.list(A,{before:NaN}),{status:400});
 for(let n=0;n<3;n++)x.store.change(A,x.save());assert.throws(()=>x.store.change(A,x.save()),{status:429});assert.equal(x.store.change(A,requests[0]).duplicate,true);
 x.advance();const request=requests[0];for(let n=1;n<=26;n++){if(n===25)x.advance();x.store.change(A,{...request,expectedRevision:n,requestKey:randomUUID()});}
 const h=x.store.history(A,request.id),next=x.store.history(A,request.id,{before:h.next});assert.equal(h.items.length,25);assert.equal(next.items.length,2);assert.equal(new Set([...h.items,...next.items].map(r=>r.revision)).size,27);
});
