const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),express=require('express');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hv-treasury-http-'));
process.env.DB_PATH=path.join(temp,'website.sqlite');process.env.AUTOMATION_DB_PATH=path.join(temp,'automation.sqlite');
process.env.HOLLOW_VALLEY_API_TOKEN='synthetic-treasury-test-token';process.env.GROUP_TREASURY_ENABLED='1';
for(const key of ['GROUP_TREASURY_READ_ONLY','SKIN_STUDIO_READ_ONLY','RENDER_SERVICE_ID','RENDER_EXTERNAL_URL','PUBLIC_SITE_URL','STEAM_REALM','STEAM_RETURN_URL'])delete process.env[key];
const {db}=require('../server/db'),groups=require('../server/groupsStore');
const economy=require('../automation-platform/src/services/economyStore');
const treasury=require('../automation-platform/src/services/groupTreasuryService').createGroupTreasury(economy);
let website,automation,base,remote,dropResponse=false,holdDonation=false,held=null,failDonation=false,wrongReceipt=false,holdRead=false,heldRead=null;
const calls={donate:0,outcome:0,cancel:0,read:0};
const listen=app=>new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
test.before(async()=>{
  const auto=express();auto.use(express.json());
  auto.use('/api/website/group-treasury',(req,res,next)=>{
    const action=req.path.slice(1);if(action in calls)calls[action]++;
    if(action==='donate'&&failDonation){failDonation=false;return res.status(503).json({error:'Synthetic unavailable'});}
    if(action==='donate'&&holdDonation){holdDonation=false;held=()=>next();return;}
    if(action==='read'&&holdRead){holdRead=false;const json=res.json.bind(res);res.json=body=>{heldRead=()=>json(body);return res;};}
    if(action==='donate'&&(dropResponse||wrongReceipt)){
      const drop=dropResponse,wrong=wrongReceipt;dropResponse=false;wrongReceipt=false;const json=res.json.bind(res);
      res.json=body=>{if(drop){res.destroy();return res;}if(wrong&&body.donation)body.donation.groupId++;return json(body);};
    }
    next();
  });
  auto.use('/api/website/group-treasury',require('../automation-platform/src/routes/websiteGroupTreasuryRoutes'));
  automation=await listen(auto);remote='http://127.0.0.1:'+automation.address().port;process.env.AUTOMATION_SERVICE_URL=remote;
  const app=express();app.use(express.json());app.use((req,_res,next)=>{if(req.get('x-user'))req.user={steam_id:req.get('x-user')};next();});
  app.use('/api/group-treasury',require('../server/routes/groupTreasury'));website=await listen(app);base='http://127.0.0.1:'+website.address().port;
});
test.after(async()=>{
  if(held)held();if(heldRead)heldRead();await Promise.all([website,automation].filter(Boolean).map(server=>new Promise(resolve=>server.close(resolve))));
  db.close();economy.db.close();const target=path.resolve(temp);assert.ok(target.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(target,{recursive:true,force:true});
});
let count=0;
function seed(){const n=++count,A=String(76561198000000000n+BigInt(n*10+1)),B=String(76561198000000000n+BigInt(n*10+2));
  for(const [steam,name]of[[A,'Donor'],[B,'Other player']])db.prepare('INSERT INTO users(steam_id,username) VALUES(?,?)').run(steam,name);
  const groupId=groups.createGroup(A,'Treasury fixture '+n).current.id;
  for(const steam of [A,B])economy.applyWalletTransaction({steamId:steam,amount:1000,kind:'fixture',reason:'Synthetic Treasury fixture',idempotencyKey:'fixture:'+steam});
  return {A,B,groupId};
}
async function request(steam,url='',body,origin=base){
  const response=await fetch(base+'/api/group-treasury'+url,{method:body===undefined?'GET':'POST',headers:{'x-user':steam||'',Origin:origin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,body:await response.json(),cache:response.headers.get('cache-control')};
}
const prepare=(f,key='prepare_0001')=>request(f.A,'/donations',{expectedGroupId:f.groupId,amount:100,requestId:key});
const confirm=(f,id)=>request(f.A,`/donations/${id}/confirm`,{confirmed:true,expectedGroupId:f.groupId});
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Fixture observation timed out');}
test('Treasury routes bind Steam sessions and require bearer, origin, JSON and writable settings',async()=>{
  const f=seed();assert.equal((await request()).status,401);assert.equal((await request('bad')).status,403);
  for(const action of ['read','outcome','donate','cancel']){
    const response=await fetch(remote+'/api/website/group-treasury/'+action,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer wrong'},body:JSON.stringify({steamId:f.A,groupId:f.groupId,amount:100,requestId:'unauth_0001'})});
    assert.equal(response.status,401);
  }
  const body={expectedGroupId:f.groupId,amount:100,requestId:'guarded_0001'};
  assert.equal((await request(f.A,'/donations',body,'https://other.invalid')).status,403);
  const nonJson=await fetch(base+'/api/group-treasury/donations',{method:'POST',headers:{'x-user':f.A,Origin:base,'Content-Type':'text/plain'},body:'invalid'});assert.equal(nonJson.status,403);
  process.env.GROUP_TREASURY_READ_ONLY='1';assert.equal((await request(f.A,'/donations',body)).status,403);delete process.env.GROUP_TREASURY_READ_ONLY;
  process.env.SKIN_STUDIO_READ_ONLY='1';assert.equal((await request(f.A,'/donations',body)).status,403);delete process.env.SKIN_STUDIO_READ_ONLY;
  process.env.GROUP_TREASURY_ENABLED='0';assert.equal((await request(f.A,'/donations',body)).status,503);process.env.GROUP_TREASURY_ENABLED='1';
  assert.equal(economy.getWallet(f.A).balance,1000);
});
test('prepared donations retain exact consent details and require a separate confirmation',async()=>{
  const f=seed(),created=await request(f.A,'/donations',{expectedGroupId:f.groupId,amount:100,requestId:'consent_0001',steamId:f.B,groupId:999});
  assert.equal(created.status,200);assert.equal(created.body.state,'draft');assert.equal(created.cache,'private, no-store');
  assert.equal((await request(f.A,'/donations',{expectedGroupId:f.groupId,amount:100,requestId:'consent_0001'})).body.id,created.body.id);
  assert.equal((await request(f.A,'/donations',{expectedGroupId:f.groupId,amount:101,requestId:'consent_0001'})).status,409);
  assert.equal((await prepare(f,'different_0001')).status,409);
  const id=created.body.id;
  assert.equal((await request(f.B,`/donations/${id}`)).status,404);
  assert.equal((await request(f.A,`/donations/${id}/confirm`,{expectedGroupId:f.groupId,confirmed:'true'})).status,400);
  assert.equal((await request(f.A,`/donations/${id}/confirm`,{expectedGroupId:f.groupId+1,confirmed:true})).status,409);
  const result=await confirm(f,id);assert.equal(result.body.state,'confirmed');assert.equal(result.body.receipt.requestId,id);
  assert.equal(economy.getWallet(f.A).balance,900);assert.equal(economy.getWallet(f.B).balance,1000);assert.equal(treasury.get(f.groupId).balance,100);
  assert.equal((await confirm(f,id)).body.receipt.id,result.body.receipt.id);
  const state=await request(f.A,'?groupId=999');assert.equal(state.body.treasury.groupId,f.groupId);assert.equal(JSON.stringify(state.body).includes(f.A),false);
});
test('lost donation acknowledgements reconcile after coordinator reinitialization without another debit',async()=>{
  const f=seed(),id=(await prepare(f)).body.id,before=calls.donate;dropResponse=true;
  const pending=await confirm(f,id);assert.equal(pending.body.state,'submitted');assert.ok(pending.body.authorizedAt);
  assert.equal(economy.getWallet(f.A).balance,900);
  const client=require('../server/services/automationWebsiteClient');
  const coordinator=require('../server/services/groupTreasury').createGroupTreasury(db,groups,{outcome:body=>client.groupTreasuryRequest('outcome',body)});
  const settled=await coordinator.reconcile(f.A,id);assert.equal(settled.state,'confirmed');assert.equal(calls.donate,before+1);
  assert.equal((await request(f.A,`/donations/${id}`)).body.state,'confirmed');
});
test('membership changes before confirmation reject stale consent; donor can cancel after leaving',async()=>{
  const f=seed(),id=(await prepare(f)).body.id,before=calls.donate;groups.exitGroup(f.A);
  const replacement=groups.createGroup(f.A,'Replacement treasury '+count).current.id;
  assert.equal((await confirm(f,id)).status,409);assert.equal(calls.donate,before);
  assert.equal((await request(f.A,`/donations/${id}/cancel`,{})).body.state,'cancelled');
  assert.equal((await request(f.A,'/donations',{expectedGroupId:replacement,amount:10,requestId:'replacement_0001'})).body.groupId,replacement);
  assert.equal(economy.getWallet(f.A).balance,1000);
});
test('uncertain donations are not resubmitted to a former group; cancellation works while rollout is off',async()=>{
  const f=seed(),id=(await prepare(f)).body.id;failDonation=true;assert.equal((await confirm(f,id)).body.state,'submitted');
  const before=calls.donate;groups.exitGroup(f.A);process.env.GROUP_TREASURY_ENABLED='0';
  assert.equal((await confirm(f,id)).body.state,'submitted');assert.equal(calls.donate,before);
  const cancelled=await request(f.A,`/donations/${id}/cancel`,{});assert.equal(cancelled.body.state,'cancelled');
  const afterLeave=await request(f.A);assert.equal(afterLeave.body.group,null);assert.equal(afterLeave.body.donations[0].state,'cancelled');
  process.env.GROUP_TREASURY_ENABLED='1';
  assert.throws(()=>treasury.donate({steamId:f.A,groupId:f.groupId,amount:100,requestId:id}),error=>error.code==='DONATION_CANCELLED');
  assert.equal(economy.getWallet(f.A).balance,1000);
});
test('cancellation wins against a delayed donation request without refunding or moving coins',async()=>{
  const f=seed(),id=(await prepare(f)).body.id;holdDonation=true;held=null;
  const pending=confirm(f,id);await until(()=>held);
  assert.equal((await request(f.A,`/donations/${id}/cancel`,{})).body.state,'cancelled');held();held=null;
  assert.equal((await pending).body.state,'cancelled');assert.equal(economy.getWallet(f.A).balance,1000);assert.equal(treasury.get(f.groupId).balance,0);
});
test('cancelling an already committed donation returns its receipt without a refund',async()=>{
  const f=seed(),id=(await prepare(f)).body.id;dropResponse=true;await confirm(f,id);
  const result=await request(f.A,`/donations/${id}/cancel`,{});assert.equal(result.body.state,'confirmed');
  assert.equal(economy.getWallet(f.A).balance,900);assert.equal(treasury.get(f.groupId).balance,100);
});
test('mismatched remote receipts stay pending until matching accounting evidence is reconciled',async()=>{
  const f=seed(),id=(await prepare(f)).body.id;wrongReceipt=true;
  const pending=await confirm(f,id);assert.equal(pending.body.state,'submitted');assert.equal(pending.body.lastErrorCode,'TREASURY_RESPONSE_MISMATCH');
  const before=calls.donate;assert.equal((await request(f.A,`/donations/${id}/reconcile`,{})).body.state,'confirmed');assert.equal(calls.donate,before);
});
test('failed authorization audit prevents dispatch; failed receipt audit remains recoverable',async()=>{
  const f=seed(),id=(await prepare(f)).body.id,before=calls.donate;
  db.exec("CREATE TRIGGER fail_authorization BEFORE INSERT ON hv_group_treasury_intent_events WHEN NEW.state='submitted' BEGIN SELECT RAISE(ABORT,'fixture authorization failure'); END");
  assert.equal((await confirm(f,id)).status,502);assert.equal(calls.donate,before);assert.equal((await request(f.A,`/donations/${id}`)).body.state,'draft');
  db.exec("DROP TRIGGER fail_authorization; CREATE TRIGGER fail_receipt BEFORE INSERT ON hv_group_treasury_intent_events WHEN NEW.state='confirmed' BEGIN SELECT RAISE(ABORT,'fixture receipt failure'); END");
  assert.equal((await confirm(f,id)).body.state,'submitted');assert.equal(economy.getWallet(f.A).balance,900);
  db.exec('DROP TRIGGER fail_receipt');assert.equal((await request(f.A,`/donations/${id}/reconcile`,{})).body.state,'confirmed');assert.equal(calls.donate,before+1);
});
test('a pending group balance read is rejected after membership ends',async()=>{
  const f=seed();holdRead=true;heldRead=null;const pending=request(f.A);await until(()=>heldRead);
  groups.exitGroup(f.A);heldRead();heldRead=null;const result=await pending;
  assert.equal(result.status,409);assert.equal(result.body.treasury,undefined);
});
