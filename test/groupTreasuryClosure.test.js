const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),express=require('express');
const {spawn}=require('node:child_process');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hv-closure-'));
process.env.DB_PATH=path.join(temp,'website.sqlite');process.env.AUTOMATION_DB_PATH=path.join(temp,'economy.sqlite');
process.env.GROUP_TREASURY_ENABLED='1';process.env.HOLLOW_VALLEY_API_TOKEN='synthetic-closure-test-token';
for(const key of ['GROUP_TREASURY_READ_ONLY','SKIN_STUDIO_READ_ONLY','RENDER_SERVICE_ID','RENDER_EXTERNAL_URL','PUBLIC_SITE_URL','STEAM_REALM','STEAM_RETURN_URL'])delete process.env[key];
const {db}=require('../server/db'),groups=require('../server/groupsStore'),economy=require('../automation-platform/src/services/economyStore');
const treasury=require('../automation-platform/src/services/groupTreasuryService').createGroupTreasury(economy);
const lifecycle=require('../server/services/groupTreasuryLifecycle').createGroupTreasuryLifecycle(db);
const remoteClosure=require('../automation-platform/src/services/groupTreasuryClosure').createGroupTreasuryClosure(economy);
let website,automation,base,remote,failBegin=false,dropBegin=false,dropAbort=false,dropComplete=false,holdBegin=false,held=null,holdReply=false,heldReply=null,wrongReply=false;
const calls={begin:0,abort:0,complete:0};
const listen=app=>new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
test.before(async()=>{
  const auto=express();auto.use(express.json());auto.use('/api/website/group-treasury',(req,res,next)=>{
    const action=req.path.slice(1).replace('closure-','');if(action in calls)calls[action]++;
    if(action==='begin'&&failBegin){failBegin=false;return res.status(503).json({error:'Synthetic outage'});}
    if(action==='begin'&&holdBegin){holdBegin=false;held=()=>next();return;}
    const drop=(action==='begin'&&dropBegin)||(action==='abort'&&dropAbort)||(action==='complete'&&dropComplete);
    if(drop){dropBegin=false;dropAbort=false;dropComplete=false;res.json=()=>{res.destroy();return res;};}
    if(action==='begin'&&holdReply){holdReply=false;const json=res.json.bind(res);res.json=body=>{heldReply=()=>json(body);return res;};}
    if(action==='begin'&&wrongReply){wrongReply=false;const json=res.json.bind(res);res.json=body=>json({...body,groupId:body.groupId+1});}
    next();
  });auto.use('/api/website/group-treasury',require('../automation-platform/src/routes/websiteGroupTreasuryRoutes'));
  automation=await listen(auto);remote='http://127.0.0.1:'+automation.address().port;process.env.AUTOMATION_SERVICE_URL=remote;
  const app=express();app.use(express.json());app.use((req,_res,next)=>{if(req.get('x-user'))req.user={steam_id:req.get('x-user')};next();});
  app.use('/api/groups',require('../server/routes/groups'));app.use('/api/group-treasury',require('../server/routes/groupTreasury'));
  website=await listen(app);base='http://127.0.0.1:'+website.address().port;
});
test.after(async()=>{if(held)held();if(heldReply)heldReply();await Promise.all([website,automation].filter(Boolean).map(server=>new Promise(resolve=>server.close(resolve))));
  db.close();economy.db.close();const target=path.resolve(temp);assert.ok(target.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(target,{recursive:true,force:true});});
let count=0;
function seed({members=false}={}){process.env.GROUP_TREASURY_ENABLED='1';const n=++count,A=String(76561198000001000n+BigInt(n*10+1)),B=String(76561198000001000n+BigInt(n*10+2));
  for(const steam of [A,B]){db.prepare('INSERT INTO users(steam_id,username) VALUES(?,?)').run(steam,'Fixture '+steam.slice(-3));economy.applyWalletTransaction({steamId:steam,amount:1000,kind:'fixture',reason:'Synthetic test funding',idempotencyKey:'fixture:'+steam});}
  const groupId=groups.createGroup(A,'Closure Pack '+n).current.id;if(members){groups.invite(A,B);groups.actOnInvite(B,groups.getState(B).incoming[0].id,'accept');}return {A,B,groupId};
}
async function request(actor,url,body,origin=base){const response=await fetch(base+url,{method:body===undefined?'GET':'POST',headers:{'x-user':actor||'',Origin:origin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};}
const close=(f,action='disband')=>request(f.A,'/api/groups/'+action,{expectedGroupId:f.groupId});
const cancel=f=>request(f.A,'/api/groups/closure/cancel',{expectedGroupId:f.groupId,requestId:lifecycle.read(f.groupId).request_id});
async function prepare(f,actor=f.A){return (await request(actor,'/api/group-treasury/donations',{expectedGroupId:f.groupId,amount:100,requestId:'prepare_'+f.groupId+'_'+actor})).body;}
async function donate(f){const draft=await prepare(f);const result=await request(f.A,'/api/group-treasury/donations/'+draft.id+'/confirm',{confirmed:true,expectedGroupId:f.groupId});assert.equal(result.body.state,'confirmed');return result.body;}
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Fixture wait timed out');}
function code(fn,value){assert.throws(fn,error=>error.code===value);}
test('unresolved donations block disband and last-member departure, including direct store calls',async()=>{
  const f=seed();await prepare(f);const before=calls.begin;
  code(()=>groups.disband(f.A),'TREASURY_REQUESTS_PENDING');code(()=>groups.exitGroup(f.A),'TREASURY_REQUESTS_PENDING');
  assert.equal((await close(f)).body.code,'TREASURY_REQUESTS_PENDING');assert.equal((await close(f,'leave')).status,409);
  assert.equal(calls.begin,before);assert.equal(groups.getState(f.A).previous.length,0);
});
test('funded groups cannot close even when new donations are disabled; failed closure checks safely reopen',async()=>{
  const f=seed();await donate(f);process.env.GROUP_TREASURY_ENABLED='0';
  const result=await close(f);assert.equal(result.status,409);assert.equal(result.body.code,'TREASURY_FUNDS_REMAIN');
  assert.equal(lifecycle.read(f.groupId).state,'cancelled');assert.equal(groups.getState(f.A).current.id,f.groupId);assert.equal(treasury.get(f.groupId).balance,100);
  assert.equal(economy.getWallet(f.A).balance,900);process.env.GROUP_TREASURY_ENABLED='1';
});
test('ordinary departures preserve ownership succession while funds and another member remain',async()=>{
  const f=seed({members:true});await donate(f);await prepare(f,f.B);const before=calls.begin;
  const result=await close(f,'leave');assert.equal(result.status,200);assert.equal(result.body.current,null);
  assert.equal(groups.getState(f.B).current.ownerSteamId,f.B);assert.equal(treasury.get(f.groupId).balance,100);assert.equal(calls.begin,before);
});
test('groups with no authorized Treasury activity keep legacy closure without a remote dependency',async()=>{
  const f=seed();process.env.GROUP_TREASURY_ENABLED='0';const before=calls.begin;
  assert.equal((await close(f,'leave')).status,200);assert.equal(calls.begin,before);assert.equal(groups.getState(f.A).previous[0].outcome,'left');process.env.GROUP_TREASURY_ENABLED='1';
});
test('outage retains a durable closure check, blocks new funding/membership changes and supports cancellation',async()=>{
  const f=seed();failBegin=true;assert.equal((await close(f)).status,502);const ticket=lifecycle.read(f.groupId);assert.equal(ticket.state,'checking');
  assert.equal((await prepare(f)).code,'GROUP_CLOSURE_PENDING');code(()=>groups.exitGroup(f.A),'GROUP_CLOSURE_PENDING');code(()=>groups.invite(f.A,f.B),'GROUP_CLOSURE_PENDING');
  const wrong=await request(f.A,'/api/groups/closure/cancel',{expectedGroupId:f.groupId,requestId:'wrong_ticket_0001'});assert.equal(wrong.status,409);
  assert.equal((await cancel(f)).status,200);assert.equal(lifecycle.read(f.groupId).state,'cancelled');assert.ok((await prepare(f)).id);
});
test('lost freeze response reuses one ticket and preserves the closing history exactly once',async()=>{
  const f=seed();dropBegin=true;assert.equal((await close(f,'leave')).status,502);const ticket=lifecycle.read(f.groupId).request_id;
  const restarted=await resumeChild(f,'leave');assert.equal(restarted.current,null);assert.equal(lifecycle.read(f.groupId).request_id,ticket);assert.equal(lifecycle.read(f.groupId).state,'closed');
  assert.equal(groups.getState(f.A).previous.filter(row=>row.groupId===f.groupId).length,1);
  assert.equal(economy.db.prepare("SELECT COUNT(*) n FROM economy_group_treasury_closure_audit WHERE request_id=? AND state='frozen'").get(ticket).n,1);
});
test('cancellation blocks a delayed freeze request and a late clearance response',async()=>{
  for(const phase of ['request','response']){
    const f=seed();held=null;heldReply=null;if(phase==='request')holdBegin=true;else holdReply=true;
    const pending=close(f);await until(()=>phase==='request'?held:heldReply);
    assert.equal((await cancel(f)).status,200);process.env.GROUP_TREASURY_ENABLED='0';if(phase==='request'){held();held=null;}else{heldReply();heldReply=null;}
    assert.equal((await pending).body.code,'CLOSURE_CHECK_CANCELLED');assert.equal(groups.getState(f.A).current.id,f.groupId);assert.equal(lifecycle.read(f.groupId).state,'cancelled');
    code(()=>groups.disband(f.A,{expectedGroupId:f.groupId,closureRequestId:lifecycle.read(f.groupId).request_id}),'GROUP_CLOSURE_PENDING');process.env.GROUP_TREASURY_ENABLED='1';
    assert.equal((await prepare(f)).state,'draft');
  }
});
test('failed group-history writes preserve active membership and cleared gate for a safe retry',async()=>{
  const f=seed();db.exec("CREATE TRIGGER fail_closure_history BEFORE INSERT ON hv_group_history BEGIN SELECT RAISE(ABORT,'fixture history failure'); END");
  assert.equal((await close(f)).status,502);assert.equal(groups.getState(f.A).current.id,f.groupId);assert.equal(lifecycle.read(f.groupId).state,'cleared');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM hv_group_history WHERE group_id=?').get(f.groupId).n,0);
  db.exec("DROP TRIGGER fail_closure_history; CREATE TRIGGER fail_terminal_closure BEFORE INSERT ON hv_group_treasury_closure_events WHEN NEW.state='closed' BEGIN SELECT RAISE(ABORT,'fixture terminal audit failure'); END");
  assert.equal((await close(f)).status,502);assert.equal(groups.getState(f.A).current.id,f.groupId);assert.equal(lifecycle.read(f.groupId).state,'cleared');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM hv_group_history WHERE group_id=?').get(f.groupId).n,0);
  db.exec('DROP TRIGGER fail_terminal_closure');assert.equal((await close(f)).status,200);assert.equal(lifecycle.read(f.groupId).state,'closed');
});
test('lost completion response can be reconciled after joining a replacement group',async()=>{
  const f=seed();dropComplete=true;const closed=await close(f);assert.equal(closed.status,200);assert.equal(closed.body.closurePending[0].groupId,f.groupId);
  const next=groups.createGroup(f.A,'Replacement Closure '+count).current.id;
  const result=await request(f.A,'/api/groups/closure/reconcile',{expectedGroupId:f.groupId});assert.equal(result.status,200);assert.equal(result.body.current.id,next);assert.deepEqual(result.body.closurePending,[]);
  assert.equal(lifecycle.read(f.groupId).remote_complete,1);
});
test('lost abort acknowledgment and mismatched clearance never silently reopen or close a group',async()=>{
  const f=seed();wrongReply=true;assert.equal((await close(f)).status,502);assert.equal(lifecycle.read(f.groupId).state,'checking');
  dropAbort=true;assert.equal((await cancel(f)).status,502);assert.equal(lifecycle.read(f.groupId).state,'cancelling');
  assert.equal((await cancel(f)).status,200);assert.equal(groups.getState(f.A).current.id,f.groupId);assert.equal(lifecycle.read(f.groupId).state,'cancelled');
});
test('fully spent groups close without deleting receipts, cosmetics or personal wallet history',async()=>{
  const f=seed(),donation=await donate(f);
  const spending=require('../automation-platform/src/services/groupTreasurySpending').createGroupTreasurySpending(economy,{enabled:()=>true});
  const item={id:'closure-frame',revision:1,title:'Synthetic frame',description:'Test only',cost:100,purpose:'group_cosmetic',target:{kind:'profile_frame',value:'fern'}};
  spending.register(item,f.A);spending.setEnabled(item.id,1,true,f.A);spending.reserve({groupId:f.groupId,actorSteamId:f.A,itemId:item.id,revision:1,expectedCost:100,requestId:'spend_'+f.groupId});
  spending.commit({groupId:f.groupId,actorSteamId:f.A,requestId:'spend_'+f.groupId});assert.equal((await close(f)).status,200);
  assert.equal(spending.cosmetics(f.groupId).length,1);assert.equal((await request(f.A,'/api/group-treasury/donations/'+donation.id)).body.state,'confirmed');
  code(()=>treasury.donate({steamId:f.A,groupId:f.groupId,amount:1,requestId:'late_donation_'+f.groupId}),'GROUP_CLOSING');assert.equal(economy.getWallet(f.A).balance,900);
});
test('closure operations require correct group, authority, origin and preview permissions',async()=>{
  const f=seed({members:true});const outsider=seed();
  assert.equal((await request('', '/api/groups/disband',{expectedGroupId:f.groupId})).status,401);
  assert.equal((await request(f.B,'/api/groups/disband',{expectedGroupId:f.groupId})).status,403);
  assert.equal((await request(f.A,'/api/groups/disband',{expectedGroupId:outsider.groupId})).status,409);
  assert.equal((await request(f.A,'/api/groups/disband',{expectedGroupId:f.groupId},'https://other.invalid')).status,403);
  process.env.GROUP_TREASURY_READ_ONLY='1';assert.equal((await close(f)).status,403);delete process.env.GROUP_TREASURY_READ_ONLY;
  assert.equal(groups.getState(f.A).current.id,f.groupId);
});
function child(action,input){const source=`const store=require(${JSON.stringify(require.resolve('../automation-platform/src/services/economyStore'))});
  try{const service=require(${JSON.stringify(require.resolve('../automation-platform/src/services/groupTreasuryClosure'))}).createGroupTreasuryClosure(store);
    const donation=require(${JSON.stringify(require.resolve('../automation-platform/src/services/groupTreasuryService'))}).createGroupTreasury(store);
    process.stdout.write(JSON.stringify(${action==='donate'?'donation.donate':'service.begin'}(${JSON.stringify(input)})));}
  catch(e){process.stdout.write(JSON.stringify({code:e.code}));}finally{store.db.close();}`;
  return new Promise((resolve,reject)=>{const p=spawn(process.execPath,['-e',source],{env:{...process.env,AUTOMATION_DB_PATH:economy.dbPath,GROUP_TREASURY_ENABLED:'1'},windowsHide:true});let output='',errors='';p.stdout.on('data',data=>{output+=data;});p.stderr.on('data',data=>{errors+=data;});p.on('error',reject);p.on('close',status=>{if(status!==0)return reject(new Error(errors));try{resolve(JSON.parse(output));}catch(e){reject(e);}});});}
test('independent donation and freeze processes choose one safe outcome under the accounting lock',async()=>{
  const f=seed(),ticket={groupId:f.groupId,actorSteamId:f.A,action:'disband',requestId:'race_closure_'+f.groupId};
  const [freeze,donation]=await Promise.all([child('begin',ticket),child('donate',{groupId:f.groupId,steamId:f.A,amount:100,requestId:'race_donation_'+f.groupId})]);
  if(freeze.state==='frozen'){assert.equal(donation.code,'GROUP_CLOSING');assert.equal(treasury.get(f.groupId).balance,0);assert.equal(economy.getWallet(f.A).balance,1000);}
  else{assert.equal(freeze.code,'TREASURY_FUNDS_REMAIN');assert.equal(donation.duplicate,false);assert.equal(treasury.get(f.groupId).balance,100);assert.equal(economy.getWallet(f.A).balance,900);}
});
test('closed accounting tickets cannot reopen; mismatched ticket identity fails',()=>{
  const f=seed(),ticket={groupId:f.groupId,actorSteamId:f.A,action:'leave',requestId:'terminal_closure_'+f.groupId};
  assert.equal(remoteClosure.begin(ticket).state,'frozen');assert.equal(remoteClosure.complete(ticket).state,'closed');assert.equal(remoteClosure.abort(ticket).state,'closed');
  code(()=>remoteClosure.begin({...ticket,groupId:f.groupId+1}),'CLOSURE_CONFLICT');code(()=>remoteClosure.begin({...ticket,requestId:'different_ticket_'+f.groupId}),'CLOSURE_CONFLICT');
});
test('failed accounting freeze audit cannot leave an unrecorded funding block',()=>{
  const f=seed(),ticket={groupId:f.groupId,actorSteamId:f.A,action:'leave',requestId:'audit_closure_'+f.groupId};
  economy.db.exec("CREATE TRIGGER fail_freeze BEFORE INSERT ON economy_group_treasury_closure_audit WHEN NEW.state='frozen' BEGIN SELECT RAISE(ABORT,'fixture freeze audit failure'); END");
  assert.throws(()=>remoteClosure.begin(ticket),/fixture freeze audit failure/);
  assert.equal(economy.db.prepare('SELECT request_id FROM economy_group_treasury_closures WHERE request_id=?').get(ticket.requestId),undefined);
  economy.db.exec('DROP TRIGGER fail_freeze');assert.equal(remoteClosure.begin(ticket).state,'frozen');
});
function resumeChild(f,action){
  const source=`(async()=>{const groups=require(${JSON.stringify(require.resolve('../server/groupsStore'))});
    const db=require(${JSON.stringify(require.resolve('../server/db'))}).db;
    const api=require(${JSON.stringify(require.resolve('../server/services/automationWebsiteClient'))});
    const service=require(${JSON.stringify(require.resolve('../server/services/groupTreasuryClosure'))}).createGroupTreasuryClosure(db,groups,{
      begin:body=>api.groupTreasuryRequest('closure-begin',body),abort:body=>api.groupTreasuryRequest('closure-abort',body),complete:body=>api.groupTreasuryRequest('closure-complete',body)});
    try{process.stdout.write(JSON.stringify(await service.close(${JSON.stringify(f.A)},${JSON.stringify(action)},{expectedGroupId:${f.groupId}})));}
    finally{db.close();}})().catch(e=>{process.stderr.write(e.stack);process.exitCode=1;});`;
  return new Promise((resolve,reject)=>{const p=spawn(process.execPath,['-e',source],{env:{...process.env,DB_PATH:path.join(temp,'website.sqlite')},windowsHide:true});let output='',errors='';p.stdout.on('data',data=>{output+=data;});p.stderr.on('data',data=>{errors+=data;});p.on('error',reject);p.on('close',status=>{if(status!==0)return reject(new Error(errors));try{resolve(JSON.parse(output));}catch(e){reject(e);}});});
}
