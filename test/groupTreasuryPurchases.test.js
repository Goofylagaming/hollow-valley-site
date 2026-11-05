const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),express=require('express');
const {spawn}=require('node:child_process');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hv-treasury-purchases-'));
process.env.DB_PATH=path.join(temp,'website.sqlite');process.env.AUTOMATION_DB_PATH=path.join(temp,'economy.sqlite');
process.env.GROUP_TREASURY_ENABLED='1';process.env.GROUP_TREASURY_SPEND_ENABLED='1';process.env.HOLLOW_VALLEY_API_TOKEN='synthetic-owner-purchase-token';
for(const key of ['GROUP_TREASURY_READ_ONLY','SKIN_STUDIO_READ_ONLY','RENDER_SERVICE_ID','RENDER_EXTERNAL_URL','PUBLIC_SITE_URL','STEAM_REALM','STEAM_RETURN_URL'])delete process.env[key];
const {db}=require('../server/db'),groups=require('../server/groupsStore'),economy=require('../automation-platform/src/services/economyStore');
const treasury=require('../automation-platform/src/services/groupTreasuryService').createGroupTreasury(economy);
const spending=require('../automation-platform/src/services/groupTreasurySpending').createGroupTreasurySpending(economy);
let website,automation,base,remote,dropReserve=false,dropCommit=false,holdReserve=false,heldReserve=null,holdCommit=false,heldCommit=null,wrongReceipt=false,holdCatalog=false,heldCatalog=null;
const calls={reserve:0,commit:0,release:0};
const listen=app=>new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
test.before(async()=>{
  const auto=express();auto.use(express.json());auto.use('/api/website/group-treasury',(req,res,next)=>{
    const action=req.path.slice(1).replace('spend-','');if(action in calls)calls[action]++;
    if(req.path==='/spending-read'&&holdCatalog){holdCatalog=false;const json=res.json.bind(res);res.json=body=>{heldCatalog=()=>json(body);return res;};}
    if(action==='reserve'&&holdReserve){holdReserve=false;heldReserve=()=>next();return;}
    if(action==='commit'&&holdCommit){holdCommit=false;heldCommit=()=>next();return;}
    if((action==='reserve'&&dropReserve)||(action==='commit'&&dropCommit)){
      dropReserve=false;dropCommit=false;res.json=()=>{res.destroy();return res;};
    }
    if(action==='commit'&&wrongReceipt){wrongReceipt=false;const json=res.json.bind(res);res.json=body=>json({...body,item:{...body.item,cost:body.item.cost+1}});}
    next();
  });auto.use('/api/website/group-treasury',require('../automation-platform/src/routes/websiteGroupTreasuryRoutes'));
  automation=await listen(auto);remote='http://127.0.0.1:'+automation.address().port;process.env.AUTOMATION_SERVICE_URL=remote;
  const app=express();app.use(express.json());app.use((req,_res,next)=>{if(req.get('x-user'))req.user={steam_id:req.get('x-user')};next();});
  app.use('/api/group-treasury',require('../server/routes/groupTreasury'));app.use('/api/groups',require('../server/routes/groups'));
  website=await listen(app);base='http://127.0.0.1:'+website.address().port;
});
test.after(async()=>{if(heldReserve)heldReserve();if(heldCommit)heldCommit();if(heldCatalog)heldCatalog();await Promise.all([website,automation].filter(Boolean).map(server=>new Promise(resolve=>server.close(resolve))));
  db.close();economy.db.close();const target=path.resolve(temp);assert.ok(target.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(target,{recursive:true,force:true});});
async function request(actor,url='',body,origin=base){const response=await fetch(base+'/api/group-treasury'+url,{method:body===undefined?'GET':'POST',headers:{'x-user':actor||'',Origin:origin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json(),cache:response.headers.get('cache-control')};}
let n=0;
const item=(overrides={})=>({id:'fern-frame',revision:1,title:'Fern frame',description:'Synthetic cosmetic test item',cost:80,purpose:'group_cosmetic',target:{kind:'profile_frame',value:'fern'},...overrides});
async function seed({funded=true}={}){
  process.env.GROUP_TREASURY_ENABLED='1';process.env.GROUP_TREASURY_SPEND_ENABLED='1';
  n++;const A=String(76561198000002000n+BigInt(n*10+1)),B=String(76561198000002000n+BigInt(n*10+2)),C=String(76561198000002000n+BigInt(n*10+3));
  for(const steam of [A,B,C]){db.prepare('INSERT INTO users(steam_id,username) VALUES(?,?)').run(steam,'Synthetic '+steam.slice(-3));economy.applyWalletTransaction({steamId:steam,amount:1000,kind:'fixture',reason:'Synthetic purchase fixture',idempotencyKey:'fund:'+steam});}
  const groupId=groups.createGroup(A,'Purchase Pack '+n).current.id;groups.invite(A,B);groups.actOnInvite(B,groups.getState(B).incoming[0].id,'accept');
  for(const value of spending.list())spending.setEnabled(value.id,value.revision,false,A);
  spending.register(item(),A);spending.setEnabled('fern-frame',1,true,A);
  if(funded){const draft=(await request(A,'/donations',{expectedGroupId:groupId,amount:200,requestId:'fund_group_'+groupId})).body;
    assert.equal((await request(A,'/donations/'+draft.id+'/confirm',{expectedGroupId:groupId,confirmed:true})).body.state,'confirmed');}
  return {A,B,C,groupId};
}
const prepare=(f,extra={})=>request(f.A,'/purchases',{expectedGroupId:f.groupId,itemId:'fern-frame',revision:1,expectedCost:80,requestId:'purchase_client_'+f.groupId,...extra});
const act=(f,id,action,actor=f.A,extra={})=>request(actor,`/purchases/${id}/${action}`,{expectedGroupId:f.groupId,...(action==='confirm'?{confirmed:true}:{}),...extra});
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Fixture wait timed out');}
test('purchase management uses current owner authority and never delegates through descriptive ranks',async()=>{
  const f=await seed();require('../server/services/groupHeadquarters').createGroupHeadquarters(db,groups).setRank(f.A,{expectedGroupId:f.groupId,memberSteamId:f.B,rank:'officer',expectedRevision:0});
  assert.equal((await request()).status,401);assert.equal((await request('bad','/purchases')).status,403);
  assert.equal((await request(f.B,'/purchases',{expectedGroupId:f.groupId,itemId:'fern-frame',revision:1,expectedCost:80,requestId:'member_attempt'})).status,403);
  const draft=(await prepare(f)).body;assert.equal(draft.state,'draft');assert.equal(treasury.get(f.groupId).held,0);
  assert.equal((await act(f,draft.requestId,'confirm',f.B)).status,403);assert.equal((await act(f,draft.requestId,'release',f.B)).status,403);
  const member=await request(f.B,'/purchases');assert.equal(member.cache,'private, no-store');assert.equal(member.body.canManage,false);assert.equal(member.body.purchases[0].requestId,draft.requestId);
  assert.equal(JSON.stringify(member.body).includes(f.A),false);assert.deepEqual((await request(f.C,'/purchases')).body.purchases,[]);
});
test('catalog prices and consent are server-bound; retries cannot alter the stored benefit',async()=>{
  const f=await seed();assert.equal((await prepare(f,{expectedCost:1})).status,409);
  const draft=(await prepare(f,{actorSteamId:f.C,purpose:'combat_upgrade',target:{damage:100}})).body;
  assert.equal(draft.item.purpose,'group_cosmetic');assert.equal(draft.item.cost,80);
  assert.equal((await prepare(f)).body.requestId,draft.requestId);assert.equal((await prepare(f,{expectedCost:81})).status,409);
  assert.equal((await prepare(f,{requestId:'second_request'})).body.code,'PURCHASE_PENDING');
  assert.equal((await act(f,draft.requestId,'confirm',f.A,{confirmed:'true'})).status,400);
  assert.equal((await act(f,draft.requestId,'confirm',f.A,{expectedGroupId:f.groupId+1})).status,404);
  const result=await act(f,draft.requestId,'confirm',f.A,{expectedCost:1,itemId:'other-item'});assert.equal(result.body.state,'committed');assert.equal(result.body.item.cost,80);
  assert.equal(treasury.get(f.groupId).balance,120);assert.equal(economy.getWallet(f.A).balance,800);assert.equal((await act(f,draft.requestId,'confirm')).body.state,'committed');
  const read=await request(f.B,'/spending');assert.equal(read.body.groupId,f.groupId);assert.equal(read.body.cosmetics[0].frame,'fern');assert.equal(JSON.stringify(read.body).includes(f.A),false);
});
test('lost reservation acknowledgment recovers the same hold without automatically charging',async()=>{
  const f=await seed(),id=(await prepare(f)).body.requestId,before=calls.reserve;dropReserve=true;
  assert.equal((await act(f,id,'confirm')).body.state,'submitted');assert.equal(treasury.get(f.groupId).held,80);assert.equal(treasury.get(f.groupId).balance,200);
  assert.equal((await act(f,id,'reconcile')).body.state,'reserved');assert.equal(calls.reserve,before+1);
  assert.equal((await act(f,id,'confirm')).body.state,'committed');assert.equal(calls.reserve,before+1);assert.equal(treasury.get(f.groupId).balance,120);
});
test('a fresh process reconciles a committed purchase after its acknowledgment is lost',async()=>{
  const f=await seed(),id=(await prepare(f)).body.requestId,before=calls.commit;dropCommit=true;
  assert.equal((await act(f,id,'confirm')).body.state,'reserved');assert.equal(treasury.get(f.groupId).balance,120);
  const result=await restartReconcile(f,id);assert.equal(result.state,'committed');assert.equal(calls.commit,before+1);
  assert.equal(spending.cosmetics(f.groupId).length,1);
});
test('new owner can cancel a pending reservation; the former owner cannot resume or redirect it',async()=>{
  const f=await seed(),id=(await prepare(f)).body.requestId;holdReserve=true;heldReserve=null;
  const pending=act(f,id,'confirm');await until(()=>heldReserve);groups.exitGroup(f.A);
  assert.equal((await act(f,id,'confirm')).status,404);const own=(await request(f.B,'/purchases')).body;assert.equal(own.canManage,true);assert.equal(own.purchases[0].requestId,id);
  assert.equal((await act(f,id,'release',f.B)).body.state,'released');heldReserve();heldReserve=null;assert.equal((await pending).status,404);
  assert.equal(treasury.get(f.groupId).held,0);assert.equal(treasury.get(f.groupId).balance,200);
  assert.equal(spending.reserve({groupId:f.groupId,actorSteamId:f.B,itemId:'fern-frame',revision:1,expectedCost:80,requestId:id}).state,'released');
});
test('the new owner can release a delayed cosmetic commit without charging or granting',async()=>{
  const f=await seed(),id=(await prepare(f)).body.requestId;holdCommit=true;heldCommit=null;
  const pending=act(f,id,'confirm');await until(()=>heldCommit);
  groups.exitGroup(f.A);assert.equal((await act(f,id,'release',f.B)).body.state,'released');heldCommit();heldCommit=null;assert.equal((await pending).status,404);
  assert.equal(treasury.get(f.groupId).balance,200);assert.deepEqual(spending.cosmetics(f.groupId),[]);
});
test('disabled spending preserves recovery and releases an existing hold without refunding committed purchases',async()=>{
  const f=await seed(),id=(await prepare(f)).body.requestId;dropReserve=true;await act(f,id,'confirm');process.env.GROUP_TREASURY_SPEND_ENABLED='0';
  assert.equal((await act(f,id,'reconcile')).body.state,'reserved');assert.equal((await act(f,id,'confirm')).body.lastErrorCode,'TREASURY_SPENDING_DISABLED');
  assert.equal((await act(f,id,'release')).body.state,'released');assert.equal(treasury.get(f.groupId).balance,200);assert.equal(treasury.get(f.groupId).held,0);
  assert.equal((await prepare(f,{requestId:'disabled_request'})).status,503);
});
test('retired item revisions cannot reserve under a new price; old requests remain cancellable',async()=>{
  const f=await seed(),id=(await prepare(f)).body.requestId;spending.register(item({revision:2,cost:95}),f.A);spending.setEnabled('fern-frame',2,true,f.A);
  assert.equal((await act(f,id,'confirm')).body.lastErrorCode,'ITEM_UNAVAILABLE');assert.equal(treasury.get(f.groupId).held,0);
  assert.equal((await act(f,id,'release')).body.state,'released');
  assert.equal((await prepare(f,{revision:2,expectedCost:80,requestId:'revised_request'})).body.code,'PRICE_CHANGED');
  assert.equal((await prepare(f,{revision:2,expectedCost:95,requestId:'revised_request'})).body.item.cost,95);
});
test('external entry items remain unavailable until a verified website fulfillment path exists',async()=>{
  const f=await seed();spending.register(item({id:'territory-entry',purpose:'territory_entry',target:{eventId:7}}),f.A);spending.setEnabled('territory-entry',1,true,f.A);
  assert.equal((await prepare(f,{itemId:'territory-entry'})).body.code,'UNSUPPORTED_FULFILLMENT');assert.equal(treasury.get(f.groupId).held,0);
  assert.equal((await request(f.A,'/spending')).body.catalog.some(value=>value.id==='territory-entry'),false);
});
test('failed authorization and receipt audit writes preserve recoverable requests and a single charge',async()=>{
  const f=await seed(),id=(await prepare(f)).body.requestId,beforeReserve=calls.reserve,beforeCommit=calls.commit;
  db.exec("CREATE TRIGGER fail_purchase_authorization BEFORE INSERT ON hv_group_treasury_purchase_audit WHEN NEW.state='submitted' BEGIN SELECT RAISE(ABORT,'fixture authorization failure'); END");
  assert.equal((await act(f,id,'confirm')).status,502);assert.equal(calls.reserve,beforeReserve);
  db.exec("DROP TRIGGER fail_purchase_authorization; CREATE TRIGGER fail_purchase_reservation BEFORE INSERT ON hv_group_treasury_purchase_audit WHEN NEW.state='reserved' BEGIN SELECT RAISE(ABORT,'fixture reserve audit failure'); END");
  assert.equal((await act(f,id,'confirm')).body.state,'submitted');assert.equal(treasury.get(f.groupId).held,80);assert.equal(calls.commit,beforeCommit);
  db.exec("DROP TRIGGER fail_purchase_reservation; CREATE TRIGGER fail_purchase_receipt BEFORE INSERT ON hv_group_treasury_purchase_audit WHEN NEW.state='committed' BEGIN SELECT RAISE(ABORT,'fixture receipt audit failure'); END");
  assert.equal((await act(f,id,'confirm')).body.state,'reserved');assert.equal(treasury.get(f.groupId).balance,120);
  db.exec('DROP TRIGGER fail_purchase_receipt');assert.equal((await act(f,id,'reconcile')).body.state,'committed');assert.equal(calls.commit,beforeCommit+1);
});
test('mismatched receipts retain uncertainty until matching accounting evidence is read',async()=>{
  const f=await seed(),id=(await prepare(f)).body.requestId;wrongReceipt=true;
  const result=await act(f,id,'confirm');assert.equal(result.body.state,'reserved');assert.equal(result.body.lastErrorCode,'SPEND_RESPONSE_MISMATCH');
  const before=calls.commit;assert.equal((await act(f,id,'reconcile')).body.state,'committed');assert.equal(calls.commit,before);
});
test('pending local purchases block closing even before any accounting funds have been reserved',async()=>{
  const f=await seed({funded:false}),id=(await prepare(f)).body.requestId;
  assert.throws(()=>groups.disband(f.A),error=>error.code==='TREASURY_REQUESTS_PENDING');
  assert.equal((await act(f,id,'release')).body.state,'released');assert.equal(treasury.get(f.groupId).balance,0);
});
test('origin, preview and private bearer checks cover all owner spending actions',async()=>{
  const f=await seed(),body={expectedGroupId:f.groupId,itemId:'fern-frame',revision:1,expectedCost:80,requestId:'guarded_request'};
  assert.equal((await request(f.A,'/purchases',body,'https://other.invalid')).status,403);
  process.env.GROUP_TREASURY_READ_ONLY='1';assert.equal((await request(f.A,'/purchases',body)).status,403);delete process.env.GROUP_TREASURY_READ_ONLY;
  for(const action of ['spending-read','spend-status','spend-reserve','spend-commit','spend-release']){
    const response=await fetch(remote+'/api/website/group-treasury/'+action,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer invalid'},body:JSON.stringify(body)});assert.equal(response.status,401);
  }
});
test('only current owners can select a verified paid frame and stale selections cannot overwrite',async()=>{
  const f=await seed(),id=(await prepare(f)).body.requestId;await act(f,id,'confirm');
  const body={expectedGroupId:f.groupId,frame:'fern',expectedRevision:0};
  assert.equal((await request(f.B,'/cosmetic-frame',body)).status,403);
  assert.equal((await request(f.A,'/cosmetic-frame',{...body,frame:'night'})).body.code,'COSMETIC_NOT_OWNED');
  const selected=await request(f.A,'/cosmetic-frame',body);assert.equal(selected.body.frame,'fern');assert.equal(selected.body.revision,1);
  assert.equal(groups.getState(f.B).current.cosmeticFrame,'fern');assert.equal(treasury.get(f.groupId).balance,120);
  assert.equal((await request(f.A,'/cosmetic-frame',body)).status,409);
  groups.exitGroup(f.A);assert.equal((await request(f.A,'/cosmetic-frame',{...body,frame:'none',expectedRevision:1})).status,404);
  assert.equal((await request(f.B,'/cosmetic-frame',{...body,frame:'none',expectedRevision:1})).body.revision,2);assert.equal(groups.getState(f.B).current.cosmeticFrame,'none');
});
test('frame selection audit failure rolls back; clearing a frame does not depend on the coin service',async()=>{
  const f=await seed(),id=(await prepare(f)).body.requestId;await act(f,id,'confirm');
  db.exec("CREATE TRIGGER fail_frame_audit BEFORE INSERT ON hv_group_cosmetic_selection_audit BEGIN SELECT RAISE(ABORT,'fixture frame audit failure'); END");
  const body={expectedGroupId:f.groupId,frame:'fern',expectedRevision:0};
  assert.equal((await request(f.A,'/cosmetic-frame',body)).status,502);assert.equal(groups.getState(f.A).current.cosmeticFrame,'none');
  db.exec('DROP TRIGGER fail_frame_audit');assert.equal((await request(f.A,'/cosmetic-frame',body)).body.revision,1);
  const prior=process.env.AUTOMATION_SERVICE_URL;process.env.AUTOMATION_SERVICE_URL='http://127.0.0.1:1';
  try{assert.equal((await request(f.A,'/cosmetic-frame',{...body,frame:'none',expectedRevision:1})).body.revision,2);}
  finally{process.env.AUTOMATION_SERVICE_URL=prior;}
});
test('ownership lost while retrieving a catalog cannot create a stale purchase draft',async()=>{
  const f=await seed();holdCatalog=true;heldCatalog=null;const pending=prepare(f);await until(()=>heldCatalog);
  groups.exitGroup(f.A);heldCatalog();heldCatalog=null;assert.equal((await pending).status,404);
  assert.deepEqual((await request(f.B,'/purchases')).body.purchases,[]);assert.equal(treasury.get(f.groupId).held,0);
});
function restartReconcile(f,id){
  const source=`(async()=>{const db=require(${JSON.stringify(require.resolve('../server/db'))}).db,groups=require(${JSON.stringify(require.resolve('../server/groupsStore'))}),api=require(${JSON.stringify(require.resolve('../server/services/automationWebsiteClient'))});
    const s=require(${JSON.stringify(require.resolve('../server/services/groupTreasuryPurchases'))}).createGroupTreasuryPurchases(db,groups,{status:body=>api.groupTreasuryRequest('spend-status',body)});
    try{process.stdout.write(JSON.stringify(await s.reconcile(${JSON.stringify(f.A)},${JSON.stringify(id)},{expectedGroupId:${f.groupId}})));}finally{db.close();}})().catch(e=>{process.stderr.write(e.stack);process.exitCode=1;});`;
  return new Promise((resolve,reject)=>{const p=spawn(process.execPath,['-e',source],{env:process.env,windowsHide:true});let output='',errors='';p.stdout.on('data',data=>{output+=data;});p.stderr.on('data',data=>{errors+=data;});p.on('error',reject);p.on('close',status=>{if(status!==0)return reject(new Error(errors));try{resolve(JSON.parse(output));}catch(e){reject(e);}});});
}
