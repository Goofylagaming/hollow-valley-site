const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),express=require('express');
const {spawn}=require('node:child_process');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hv-territory-settlement-'));
process.env.DB_PATH=path.join(temp,'website.sqlite');process.env.AUTOMATION_DB_PATH=path.join(temp,'economy.sqlite');
process.env.GROUP_TREASURY_ENABLED='1';process.env.GROUP_TREASURY_SPEND_ENABLED='1';
process.env.GROUP_TREASURY_TERRITORY_ENABLED='1';
process.env.GROUP_TREASURY_TERRITORY_PROOF_SECRET='synthetic-test-only-proof-key-000000000000';
process.env.HOLLOW_VALLEY_API_TOKEN='synthetic-territory-accounting-token';
const proof=require('../automation-platform/src/services/groupTreasuryTerritoryProof');
const {db}=require('../server/db'),groups=require('../server/groupsStore'),economy=require('../automation-platform/src/services/economyStore');
db.exec(fs.readFileSync(path.join(__dirname,'../server/routes/territoryWars.js'),'utf8').match(/db\.exec\(`([\s\S]*?)`\);/)[1]);
db.exec('ALTER TABLE territory_events ADD COLUMN live_test_mode INTEGER NOT NULL DEFAULT 0');
const links=require('../server/services/groupTerritoryLinks').createGroupTerritoryLinks(db,groups);
const treasury=require('../automation-platform/src/services/groupTreasuryService').createGroupTreasury(economy);
const spending=require('../automation-platform/src/services/groupTreasurySpending').createGroupTreasurySpending(economy);
let server,base,dropSettlement=false;
test.before(async()=>{
 const app=express();app.use(express.json());app.use((req,res,next)=>{if(dropSettlement&&req.path.endsWith('/spend-settle-territory')){dropSettlement=false;res.json=()=>{res.destroy();return res;};}next();});
 app.use('/api/website/group-treasury',require('../automation-platform/src/routes/websiteGroupTreasuryRoutes'));
 server=await new Promise(resolve=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));});base='http://127.0.0.1:'+server.address().port;
});
test.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();economy.db.close();const target=path.resolve(temp);assert.ok(target.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(target,{recursive:true,force:true});});
async function rpc(action,body,token=process.env.HOLLOW_VALLEY_API_TOKEN){
 const response=await fetch(base+'/api/website/group-treasury/'+action,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(body)});
 const result=await response.json();return {status:response.status,body:result};
}
let n=0;
async function fixture(){
 n++;const actor=String(76561198000012000n+BigInt(n));const userId=Number(db.prepare('INSERT INTO users(steam_id,username) VALUES(?,?)').run(actor,'Synthetic leader').lastInsertRowid);
 const groupId=groups.createGroup(actor,'Settlement '+n).current.id;
 const territoryGroupId=Number(db.prepare('INSERT INTO territory_groups(name,leader_user_id) VALUES(?,?)').run('Linked '+n,userId).lastInsertRowid);
 db.prepare("INSERT INTO territory_group_members(group_id,user_id,role) VALUES(?,?,'leader')").run(territoryGroupId,userId);
 links.set(actor,{expectedGroupId:groupId,expectedRevision:0,territoryGroupId});
 const eventId=Number(db.prepare('INSERT INTO territory_events(name) VALUES(?)').run('Synthetic '+n).lastInsertRowid);
 economy.applyWalletTransaction({steamId:actor,amount:500,kind:'fixture',reason:'Synthetic funding',idempotencyKey:'fixture:'+n});
 treasury.donate({steamId:actor,groupId,amount:200,requestId:'donation_'+n});
 const item={id:'entry-'+n,revision:1,title:'Synthetic entry',description:'No live price approval',cost:80,purpose:'territory_entry',target:{eventId}};
 spending.register(item,actor);spending.setEnabled(item.id,1,true,actor);
 const requestId='settlement_'+n,body={expectedGroupId:groupId,requestId},request={groupId,requestId,actorSteamId:actor};
 assert.equal((await rpc('spend-reserve',{...request,itemId:item.id,revision:1,expectedCost:80})).status,200);
 const delivery=require('../server/services/groupTreasuryTerritoryDelivery').createGroupTreasuryTerritoryDelivery(db,groups,{read:async value=>{
  const result=await rpc('spend-status',value);if(result.status!==200)throw new Error('Accounting unavailable');return result.body;
 }},{enabled:()=>true});
 await delivery.prepare(actor,body);
 return {actor,groupId,territoryGroupId,eventId,item,requestId,body,request,delivery,
  dispatch:()=>rpc('spend-dispatch-territory',request),
  signed:()=>delivery.signedEvidence(actor,body),
  settle:evidence=>rpc('spend-settle-territory',{...request,evidence}),
  registration:()=>db.prepare('SELECT * FROM territory_event_registrations WHERE event_id=? AND group_id=?').get(eventId,territoryGroupId)};
}
test('proof signature binds every field, domain and dedicated key; malformed evidence fails closed',()=>{
 const value={id:'proof_00001',requestId:'request_00001',groupId:1,cost:80,purpose:'territory_entry',targetKey:'5',outcome:'delivered'};
 const signed=proof.sign(value,process.env.GROUP_TREASURY_TERRITORY_PROOF_SECRET);
 assert.equal(proof.verify(signed,process.env.GROUP_TREASURY_TERRITORY_PROOF_SECRET),true);
 for(const change of [{id:'proof_00002'},{requestId:'request_00002'},{groupId:2},{cost:81},{purpose:'event_registration'},{targetKey:'6'},{outcome:'not_delivered'},{extra:true},{signature:'0'.repeat(64)}])assert.equal(proof.verify({...signed,...change},process.env.GROUP_TREASURY_TERRITORY_PROOF_SECRET),false);
 for(const key of [undefined,'short','a'.repeat(40)])assert.equal(proof.verify(signed,key),false);
 assert.throws(()=>proof.sign(value,''));assert.throws(()=>proof.sign({...value,id:12345678},'a'.repeat(40)));
});
test('real HTTP dispatch and database-signed delivery settle one charge, including after a lost reply',async()=>{
 const f=await fixture();assert.throws(f.signed,error=>error.code==='ENTRY_OUTCOME_PENDING');
 assert.equal((await f.dispatch()).body.state,'fulfilling');await f.delivery.deliver(f.actor,f.body);assert.ok(f.registration());
 const evidence=f.signed();assert.equal(proof.verify(evidence,process.env.GROUP_TREASURY_TERRITORY_PROOF_SECRET),true);
 dropSettlement=true;await assert.rejects(()=>f.settle(evidence));assert.equal(treasury.get(f.groupId).balance,120);assert.equal(treasury.get(f.groupId).held,0);
 const replay=await f.settle(evidence);assert.equal(replay.body.state,'committed');assert.equal(treasury.get(f.groupId).balance,120);
 assert.equal(economy.db.prepare('SELECT COUNT(*) n FROM economy_group_treasury_ledger WHERE spend_request_id=?').get(f.requestId).n,1);
 const wrong=proof.sign({...f.delivery.read(f.actor,f.body).evidence,cost:81},process.env.GROUP_TREASURY_TERRITORY_PROOF_SECRET);
 assert.equal((await f.settle(wrong)).status,409); // even terminal retries bind accepted price
});
test('signed cancellation releases a dispatched hold while paused and prevents late entry',async()=>{
 const f=await fixture();await f.dispatch();f.delivery.cancel(f.actor,f.body);assert.equal((await f.delivery.deliver(f.actor,f.body)).outcome,'not_delivered');
 process.env.GROUP_TREASURY_SPEND_ENABLED='0';try{const result=await f.settle(f.signed());assert.equal(result.body.state,'released');assert.equal(treasury.get(f.groupId).balance,200);assert.equal(treasury.get(f.groupId).held,0);assert.equal(f.registration(),undefined);}finally{process.env.GROUP_TREASURY_SPEND_ENABLED='1';}
});
test('unsigned, changed and wrong-group evidence cannot commit or release dispatched funds',async()=>{
 const f=await fixture();await f.dispatch();await f.delivery.deliver(f.actor,f.body);const signed=f.signed();
 const plain={...signed};delete plain.signature;
 for(const value of [plain,{...signed,outcome:'not_delivered'},{...signed,cost:1}])assert.equal((await f.settle(value)).status,403);
 assert.equal((await rpc('spend-settle-territory',{...f.request,groupId:f.groupId+1,evidence:signed})).status,409);
 assert.equal((await rpc('spend-settle-territory',{...f.request,evidence:signed},'wrong')).status,401);
 assert.equal((await rpc('spend-commit',{...f.request,fulfillmentProof:signed})).status,409); // existing cosmetic route ignores supplied proofs
 assert.equal((await rpc('spend-release',{...f.request,itemId:f.item.id,revision:1,expectedCost:80,fulfillmentProof:signed})).status,409);
 assert.equal(treasury.get(f.groupId).balance,200);assert.equal(treasury.get(f.groupId).held,80);
 assert.equal((await f.settle(signed)).body.state,'committed');
});
test('missing signing/verification key retains holds; missing local effect or audit cannot be signed',async()=>{
 const f=await fixture();const key=process.env.GROUP_TREASURY_TERRITORY_PROOF_SECRET;delete process.env.GROUP_TREASURY_TERRITORY_PROOF_SECRET;
 try{assert.equal((await f.dispatch()).status,503);}finally{process.env.GROUP_TREASURY_TERRITORY_PROOF_SECRET=key;}
 await f.dispatch();await f.delivery.deliver(f.actor,f.body);const signed=f.signed();
 delete process.env.GROUP_TREASURY_TERRITORY_PROOF_SECRET;
 try{assert.throws(f.signed,error=>error.code==='ENTRY_PROOF_NOT_CONFIGURED');assert.equal((await f.settle(signed)).status,403);}finally{process.env.GROUP_TREASURY_TERRITORY_PROOF_SECRET=key;}
 db.prepare('DELETE FROM territory_event_registrations WHERE event_id=?').run(f.eventId);assert.throws(f.signed,error=>error.code==='ENTRY_EVIDENCE_INCOMPLETE');
 const g=await fixture();await g.dispatch();g.delivery.cancel(g.actor,g.body);db.prepare("DELETE FROM hv_treasury_territory_delivery_audit WHERE request_id=? AND outcome='not_delivered'").run(g.requestId);assert.throws(g.signed,error=>error.code==='ENTRY_EVIDENCE_INCOMPLETE');
 assert.equal(treasury.get(g.groupId).held,80);
});
test('a fresh website process can reissue the same final signed outcome and settle once',async()=>{
 const f=await fixture();await f.dispatch();await f.delivery.deliver(f.actor,f.body);const signed=f.signed();
 const source=`const {db}=require(${JSON.stringify(require.resolve('../server/db'))});const groups=require(${JSON.stringify(require.resolve('../server/groupsStore'))});const service=require(${JSON.stringify(require.resolve('../server/services/groupTreasuryTerritoryDelivery'))}).createGroupTreasuryTerritoryDelivery(db,groups,{});try{process.stdout.write(JSON.stringify(service.signedEvidence(process.env.TEST_ENTRY_ACTOR,JSON.parse(process.env.TEST_ENTRY_BODY))));}finally{db.close();}`;
 const recovered=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['-e',source],{windowsHide:true,env:{...process.env,TEST_ENTRY_ACTOR:f.actor,TEST_ENTRY_BODY:JSON.stringify(f.body)}});let output='',errors='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>errors+=chunk);child.on('error',reject);child.on('close',status=>status?reject(new Error(errors)):resolve(JSON.parse(output)));});
 assert.deepEqual(recovered,signed);assert.equal((await f.settle(recovered)).body.state,'committed');assert.equal(treasury.get(f.groupId).balance,120);
});
test('accepted delivery can settle while new spending is paused, and a prior free entry releases without charging',async()=>{
 const f=await fixture();await f.dispatch();await f.delivery.deliver(f.actor,f.body);
 process.env.GROUP_TREASURY_SPEND_ENABLED='0';
 try{assert.equal((await f.settle(f.signed())).body.state,'committed');assert.equal(treasury.get(f.groupId).balance,120);}finally{process.env.GROUP_TREASURY_SPEND_ENABLED='1';}
 const g=await fixture();await g.dispatch();
 const userId=db.prepare('SELECT id FROM users WHERE steam_id=?').get(g.actor).id;
 db.prepare('INSERT INTO territory_event_registrations(event_id,group_id,registered_by_user_id) VALUES(?,?,?)').run(g.eventId,g.territoryGroupId,userId);
 const outcome=await g.delivery.deliver(g.actor,g.body);assert.equal(outcome.reason,'ALREADY_REGISTERED');
 assert.equal((await g.settle(g.signed())).body.state,'released');assert.equal(treasury.get(g.groupId).balance,200);assert.equal(treasury.get(g.groupId).held,0);
});
