const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {createGroupTreasury}=require('../src/services/groupTreasuryService');
const {createGroupTreasurySpending}=require('../src/services/groupTreasurySpending');
const A='76561198000000001',B='76561198000000002';
const item=(overrides={})=>({id:'fern-frame',revision:1,title:'Fern frame',description:'Cosmetic group profile frame',cost:80,purpose:'group_cosmetic',target:{kind:'profile_frame',value:'fern'},...overrides});
function fixture(t,{verification=true}={}){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hv-treasury-spend-')),prior=process.env.AUTOMATION_DB_PATH;
  process.env.AUTOMATION_DB_PATH=path.join(temp,'economy.sqlite');const modulePath=require.resolve('../src/services/economyStore');delete require.cache[modulePath];
  const store=require(modulePath),treasury=createGroupTreasury(store,{writesEnabled:()=>true}),proofs=new Map();let enabled=true;
  const options={enabled:()=>enabled,verifyFulfillment:verification?(proof=>proofs.get(proof.id)===JSON.stringify(proof)):null};
  const service=createGroupTreasurySpending(store,options);
  store.applyWalletTransaction({steamId:A,amount:1000,kind:'fixture',reason:'Synthetic test funding',idempotencyKey:'fixture:funding'});
  treasury.donate({steamId:A,groupId:1,amount:200,requestId:'fixture_donation'});
  t.after(()=>{store.db.close();delete require.cache[modulePath];if(prior===undefined)delete process.env.AUTOMATION_DB_PATH;else process.env.AUTOMATION_DB_PATH=prior;
    const target=path.resolve(temp);assert.ok(target.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(target,{recursive:true,force:true});});
  function add(value=item()){service.register(value,A);service.setEnabled(value.id,value.revision,true,A);return value;}
  const input=(overrides={})=>({groupId:1,actorSteamId:A,itemId:'fern-frame',revision:1,expectedCost:80,requestId:'purchase_0001',...overrides});
  function evidence(requestId,outcome='delivered',overrides={}){
    const order=service.read(1,requestId),value={id:'proof_'+requestId,requestId,groupId:1,cost:order.item.cost,purpose:order.item.purpose,targetKey:String(order.item.target.eventId),outcome,...overrides};
    proofs.set(value.id,JSON.stringify(value));return value;
  }
  return {store,db:store.db,treasury,service,add,input,evidence,options,disable:()=>{enabled=false;}};
}
function code(fn,value){assert.throws(fn,error=>error.code===value);}
function reserveChild(dbPath,input,action='reserve'){
  const source=`const store=require(${JSON.stringify(require.resolve('../src/services/economyStore'))});
    const s=require(${JSON.stringify(require.resolve('../src/services/groupTreasurySpending'))}).createGroupTreasurySpending(store);
    try{process.stdout.write(JSON.stringify(s[${JSON.stringify(action)}](${JSON.stringify(input)})));}catch(e){process.stdout.write(JSON.stringify({code:e.code}));}finally{store.db.close();}`;
  return new Promise((resolve,reject)=>{const child=spawn(process.execPath,['-e',source],{env:{...process.env,AUTOMATION_DB_PATH:dbPath,GROUP_TREASURY_ENABLED:'1',GROUP_TREASURY_SPEND_ENABLED:'1'},windowsHide:true});
    let output='',stderr='';child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{stderr+=data;});child.on('error',reject);child.on('close',status=>{if(status!==0)return reject(new Error(stderr));try{resolve(JSON.parse(output));}catch(error){reject(error);}});});
}
test('reviewed catalogs are immutable and disabled until explicitly activated; combat payloads fail',t=>{
  const {service,db}=fixture(t);service.register(item(),A);assert.deepEqual(service.list(),[]);service.register(item(),B);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM economy_group_treasury_catalog_audit WHERE action='register'").get().n,1);
  code(()=>service.register(item({cost:81}),A),'CATALOG_CONFLICT');
  for(const value of [item({power:10}),item({purpose:'combat_upgrade'}),item({target:{kind:'profile_frame',value:'fern',damage:10}}),item({cost:1.5})])assert.throws(()=>service.register(value,A));
  service.setEnabled('fern-frame',1,true,A);assert.equal(service.list()[0].cost,80);
  service.register(item({revision:2,cost:90}),A);service.setEnabled('fern-frame',2,true,A);
  assert.deepEqual(service.list().map(value=>value.revision),[2]);assert.equal(db.prepare('SELECT enabled FROM economy_group_treasury_catalog WHERE revision=1').get().enabled,0);
});
test('reservations freeze reviewed price and separate available funds from total coins',t=>{
  const {service,treasury,add,input}=fixture(t);add();const first=service.reserve(input());
  assert.equal(first.item.cost,80);assert.equal(first.state,'reserved');assert.equal(treasury.get(1).balance,200);assert.equal(treasury.get(1).available,120);assert.equal(treasury.get(1).held,80);
  assert.deepEqual(service.reserve(input()),first);code(()=>service.reserve(input({expectedCost:79})),'PRICE_CHANGED');
  add(item({id:'night-frame',cost:150,target:{kind:'profile_frame',value:'night'}}));
  code(()=>service.reserve(input({itemId:'night-frame',expectedCost:150,requestId:'purchase_0002'})),'INSUFFICIENT_TREASURY');
  code(()=>service.reserve(input({requestId:'purchase_0003'})),'BENEFIT_ALREADY_RESERVED');
  code(()=>service.reserve(input({groupId:2})),'SPEND_CONFLICT');
});
test('independent processes cannot reserve the same available funds twice',async t=>{
  const {service,treasury,store,add,input}=fixture(t);
  add(item({cost:150}));add(item({id:'night-frame',cost:150,target:{kind:'profile_frame',value:'night'}}));
  const results=await Promise.all([reserveChild(store.dbPath,input({expectedCost:150})),reserveChild(store.dbPath,input({itemId:'night-frame',expectedCost:150,requestId:'purchase_0002'}))]);
  assert.equal(results.filter(row=>row.state==='reserved').length,1);assert.equal(results.filter(row=>row.code==='INSUFFICIENT_TREASURY').length,1);
  assert.equal(treasury.get(1).held,150);assert.equal(treasury.get(1).available,50);assert.equal(service.orders(1).length,1);
});
test('cosmetic fulfillment charges once and grants the group entitlement atomically',t=>{
  const {service,treasury,store,db,add,input}=fixture(t);add();service.reserve(input());
  const result=service.commit({groupId:1,requestId:'purchase_0001',actorSteamId:A});assert.equal(result.state,'committed');
  assert.deepEqual(service.commit({groupId:1,requestId:'purchase_0001',actorSteamId:B}),result);
  assert.equal(treasury.get(1).balance,120);assert.equal(treasury.get(1).held,0);assert.equal(service.cosmetics(1)[0].frame,'fern');assert.deepEqual(service.cosmetics(2),[]);
  assert.equal(store.getWallet(A).balance,800);assert.equal(db.prepare("SELECT COUNT(*) n FROM economy_group_treasury_ledger WHERE kind='purchase'").get().n,1);
  assert.equal(service.release(input({actorSteamId:B})).state,'committed');assert.equal(treasury.get(1).balance,120);
});
test('failed grant/audit persistence rolls back charge and entitlement while retaining the hold',t=>{
  const {service,treasury,db,add,input}=fixture(t);add();service.reserve(input());
  db.exec("CREATE TRIGGER fail_spend_audit BEFORE INSERT ON economy_group_treasury_spend_audit WHEN NEW.state='committed' BEGIN SELECT RAISE(ABORT,'fixture spend failure'); END");
  assert.throws(()=>service.commit({groupId:1,requestId:'purchase_0001',actorSteamId:A}),/fixture spend failure/);
  assert.equal(treasury.get(1).balance,200);assert.equal(treasury.get(1).held,80);assert.deepEqual(service.cosmetics(1),[]);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM economy_group_treasury_ledger WHERE kind='purchase'").get().n,0);
  db.exec('DROP TRIGGER fail_spend_audit');assert.equal(service.commit({groupId:1,requestId:'purchase_0001',actorSteamId:A}).state,'committed');
});
test('release-before-reserve tombstones prevent late holds without moving or refunding coins',t=>{
  const {store,service,treasury,add,input,disable}=fixture(t);add();disable();const released=service.release(input());assert.equal(released.state,'released');
  const reopened=createGroupTreasurySpending(store,{enabled:()=>true});
  assert.deepEqual(reopened.reserve(input()),released);
  code(()=>reopened.commit({groupId:1,requestId:'purchase_0001',actorSteamId:A}),'SPEND_RELEASED');
  reopened.reserve(input({requestId:'purchase_0002'}));reopened.release(input({requestId:'purchase_0002',actorSteamId:B}));
  assert.equal(treasury.get(1).balance,200);assert.equal(treasury.get(1).held,0);
});
test('known undelivered reservations can release; dispatched uncertain holds cannot expire or refund',t=>{
  const {service,treasury,add,input,evidence}=fixture(t);
  add(item({id:'territory-entry',purpose:'territory_entry',target:{eventId:7}}));
  const request=input({itemId:'territory-entry'});service.reserve(request);service.beginFulfillment({groupId:1,requestId:request.requestId,actorSteamId:A});
  code(()=>service.release(request),'FULFILLMENT_UNVERIFIED');assert.equal(treasury.get(1).held,80);
  const failed=evidence(request.requestId,'not_delivered');assert.equal(service.release({...request,fulfillmentProof:failed}).state,'released');
  assert.equal(treasury.get(1).balance,200);assert.equal(treasury.get(1).held,0);
});
test('event entry commits only a verified matching delivery and preserves accepted cost after retirement',t=>{
  const {service,treasury,add,input,evidence,disable}=fixture(t);
  add(item({id:'event-entry',purpose:'event_registration',target:{eventId:'community-event-7'}}));
  const request=input({itemId:'event-entry'});service.reserve(request);
  code(()=>service.commit({groupId:1,requestId:request.requestId,actorSteamId:A}),'FULFILLMENT_UNVERIFIED');
  service.beginFulfillment({groupId:1,requestId:request.requestId,actorSteamId:A});service.setEnabled('event-entry',1,false,A);disable();
  const proof=evidence(request.requestId);code(()=>service.commit({groupId:1,requestId:request.requestId,actorSteamId:A,fulfillmentProof:{...proof,cost:1}}),'FULFILLMENT_UNVERIFIED');
  const result=service.commit({groupId:1,requestId:request.requestId,actorSteamId:B,fulfillmentProof:proof});
  assert.equal(result.fulfillment.id,proof.id);assert.equal(treasury.get(1).balance,120);assert.equal(treasury.get(1).held,0);
});
test('external dispatch fails closed without an evidence adapter; missing spend receipts are never recreated',t=>{
  const {service,treasury,db,add,input}=fixture(t,{verification:false});
  add(item({id:'territory-entry',purpose:'territory_entry',target:{eventId:7}}));
  service.reserve(input({itemId:'territory-entry'}));code(()=>service.beginFulfillment({groupId:1,requestId:'purchase_0001',actorSteamId:A}),'FULFILLMENT_NOT_CONFIGURED');
  service.release(input({itemId:'territory-entry'}));add();service.reserve(input({requestId:'purchase_0002'}));service.commit({groupId:1,requestId:'purchase_0002',actorSteamId:A});
  db.prepare('DELETE FROM economy_group_treasury_ledger WHERE spend_request_id=?').run('purchase_0002');
  code(()=>service.commit({groupId:1,requestId:'purchase_0002',actorSteamId:A}),'TREASURY_INTEGRITY_ERROR');code(()=>service.cosmetics(1),'TREASURY_INTEGRITY_ERROR');code(()=>treasury.get(1),'TREASURY_INTEGRITY_ERROR');assert.equal(db.prepare('SELECT balance FROM economy_group_treasuries WHERE group_id=1').get().balance,120);
});
test('a release racing a late reservation leaves no held or spent coins',async t=>{
  const {store,service,treasury,add,input}=fixture(t);add();
  await Promise.all([reserveChild(store.dbPath,input()),reserveChild(store.dbPath,input(),'release')]);
  assert.equal(service.read(1,'purchase_0001').state,'released');assert.equal(treasury.get(1).held,0);assert.equal(treasury.get(1).balance,200);
});
test('cosmetic commit racing release can only grant-and-charge once or release without granting',async t=>{
  const {store,service,treasury,add,input}=fixture(t);add();service.reserve(input());
  await Promise.all([reserveChild(store.dbPath,input(),'commit'),reserveChild(store.dbPath,input(),'release')]);
  const state=service.read(1,'purchase_0001').state;
  assert.ok(['committed','released'].includes(state));assert.equal(treasury.get(1).held,0);
  assert.equal(treasury.get(1).balance,state==='committed'?120:200);assert.equal(service.cosmetics(1).length,state==='committed'?1:0);
});
test('one delivery receipt cannot settle two purchases even if an adapter repeats its identity',t=>{
  const {service,treasury,add,input,evidence}=fixture(t);
  add(item({id:'territory-entry',purpose:'territory_entry',target:{eventId:7}}));add(item({id:'event-entry',purpose:'event_registration',target:{eventId:'event-7'}}));
  const first=input({itemId:'territory-entry'}),second=input({itemId:'event-entry',requestId:'purchase_0002'});
  service.reserve(first);service.reserve(second);service.beginFulfillment({groupId:1,requestId:first.requestId,actorSteamId:A});service.beginFulfillment({groupId:1,requestId:second.requestId,actorSteamId:A});
  const p=evidence(first.requestId);service.commit({groupId:1,requestId:first.requestId,actorSteamId:A,fulfillmentProof:p});
  const reused=evidence(second.requestId,'delivered',{id:p.id});
  code(()=>service.commit({groupId:1,requestId:second.requestId,actorSteamId:A,fulfillmentProof:reused}),'FULFILLMENT_CONFLICT');
  assert.equal(treasury.get(1).balance,120);assert.equal(treasury.get(1).held,80);
});
test('spending defaults off and disabling new spending still permits release of an undispatched hold',t=>{
  const {store,service,treasury,add,input,disable}=fixture(t);add();service.reserve(input());disable();
  code(()=>service.reserve(input({requestId:'purchase_0002'})),'TREASURY_SPENDING_DISABLED');
  code(()=>service.commit({groupId:1,requestId:'purchase_0001',actorSteamId:A}),'TREASURY_SPENDING_DISABLED');
  assert.equal(service.release(input()).state,'released');assert.equal(treasury.get(1).held,0);
  const prior=process.env.GROUP_TREASURY_SPEND_ENABLED;delete process.env.GROUP_TREASURY_SPEND_ENABLED;
  try{code(()=>createGroupTreasurySpending(store).reserve(input({requestId:'purchase_0002'})),'TREASURY_SPENDING_DISABLED');}
  finally{if(prior===undefined)delete process.env.GROUP_TREASURY_SPEND_ENABLED;else process.env.GROUP_TREASURY_SPEND_ENABLED=prior;}
});
test('fabricated or asynchronous delivery verification cannot turn a pending hold into spending',t=>{
  const {store,service,treasury,add,input}=fixture(t);
  add(item({id:'event-entry',purpose:'event_registration',target:{eventId:'event-7'}}));
  const request=input({itemId:'event-entry'});service.reserve(request);service.beginFulfillment({groupId:1,requestId:request.requestId,actorSteamId:A});
  const proof={id:'fabricated_0001',requestId:request.requestId,groupId:1,cost:80,purpose:'event_registration',targetKey:'event-7',outcome:'delivered'};
  code(()=>service.commit({groupId:1,requestId:request.requestId,actorSteamId:A,fulfillmentProof:proof}),'FULFILLMENT_UNVERIFIED');
  const asynchronous=createGroupTreasurySpending(store,{enabled:()=>true,verifyFulfillment:()=>Promise.resolve(true)});
  code(()=>asynchronous.commit({groupId:1,requestId:request.requestId,actorSteamId:A,fulfillmentProof:proof}),'FULFILLMENT_UNVERIFIED');
  assert.equal(treasury.get(1).balance,200);assert.equal(treasury.get(1).held,80);
});
