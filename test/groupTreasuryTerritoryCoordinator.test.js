const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),express=require('express');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hv-entry-owner-'));
process.env.DB_PATH=path.join(temp,'website.sqlite');process.env.AUTOMATION_DB_PATH=path.join(temp,'economy.sqlite');
process.env.GROUP_TREASURY_ENABLED='1';process.env.GROUP_TREASURY_SPEND_ENABLED='1';process.env.GROUP_TREASURY_TERRITORY_ENABLED='1';
process.env.TERRITORY_WARS_ADMIN_TEST_ENABLED='1';
process.env.GROUP_TREASURY_TERRITORY_PROOF_SECRET='synthetic-coordinator-proof-key-0000000000';process.env.HOLLOW_VALLEY_API_TOKEN='synthetic-coordinator-token';
for(const name of ['GROUP_TREASURY_READ_ONLY','SKIN_STUDIO_READ_ONLY','RENDER_SERVICE_ID','RENDER_EXTERNAL_URL','PUBLIC_SITE_URL','STEAM_REALM','STEAM_RETURN_URL'])delete process.env[name];
const {db}=require('../server/db'),groups=require('../server/groupsStore'),economy=require('../automation-platform/src/services/economyStore');
db.exec(fs.readFileSync(path.join(__dirname,'../server/routes/territoryWars.js'),'utf8').match(/db\.exec\(`([\s\S]*?)`\);/)[1]);db.exec('ALTER TABLE territory_events ADD COLUMN live_test_mode INTEGER NOT NULL DEFAULT 0');
const links=require('../server/services/groupTerritoryLinks').createGroupTerritoryLinks(db,groups);
const treasury=require('../automation-platform/src/services/groupTreasuryService').createGroupTreasury(economy),spending=require('../automation-platform/src/services/groupTreasurySpending').createGroupTreasurySpending(economy);
let autoServer,webServer,base,drop=null,hold=null,release=null;
const calls={reserve:0,dispatch:0,settle:0};
test.before(async()=>{
 const auto=express();auto.use(express.json());auto.use((req,res,next)=>{
  const action=req.path.endsWith('/spend-reserve')?'reserve':req.path.endsWith('/spend-dispatch-territory')?'dispatch':req.path.endsWith('/spend-settle-territory')?'settle':null;
  if(action)calls[action]++;
  if(action&&drop===action){drop=null;res.json=()=>{res.destroy();return res;};}
  if(action&&hold===action){hold=null;release=()=>{release=null;next();};return;}next();
 });auto.use('/api/website/group-treasury',require('../automation-platform/src/routes/websiteGroupTreasuryRoutes'));
 autoServer=await new Promise(resolve=>{const server=auto.listen(0,'127.0.0.1',()=>resolve(server));});process.env.AUTOMATION_SERVICE_URL='http://127.0.0.1:'+autoServer.address().port;
 const web=express();web.use(express.json());web.use((req,res,next)=>{if(req.get('x-user'))req.user={steam_id:req.get('x-user')};next();});web.use('/api/group-treasury',require('../server/routes/groupTreasury'));
 webServer=await new Promise(resolve=>{const server=web.listen(0,'127.0.0.1',()=>resolve(server));});base='http://127.0.0.1:'+webServer.address().port;
});
test.after(async()=>{if(release)release();await Promise.all([autoServer,webServer].map(server=>new Promise(resolve=>server.close(resolve))));db.close();economy.db.close();const target=path.resolve(temp);assert.ok(target.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(target,{recursive:true,force:true});});
async function request(actor,url,body,origin=base){const result=await fetch(base+'/api/group-treasury'+url,{method:body?'POST':'GET',headers:{'x-user':actor||'',Origin:origin,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:result.status,body:await result.json()};}
let n=0;
async function fixture(){
 n++;const A=String(76561198000014000n+BigInt(n*10)),B=String(BigInt(A)+1n);
 for(const actor of [A,B])db.prepare('INSERT INTO users(steam_id,username) VALUES(?,?)').run(actor,'Synthetic leader');
 const userId=db.prepare('SELECT id FROM users WHERE steam_id=?').get(A).id,groupId=groups.createGroup(A,'Owner entry '+n).current.id;
 groups.invite(A,B);groups.actOnInvite(B,groups.getState(B).incoming[0].id,'accept');
 const territoryGroupId=Number(db.prepare('INSERT INTO territory_groups(name,leader_user_id) VALUES(?,?)').run('Territory '+n,userId).lastInsertRowid);
 db.prepare("INSERT INTO territory_group_members(group_id,user_id,role) VALUES(?,?,'leader')").run(territoryGroupId,userId);links.set(A,{expectedGroupId:groupId,expectedRevision:0,territoryGroupId});
 const eventId=Number(db.prepare('INSERT INTO territory_events(name) VALUES(?)').run('Event '+n).lastInsertRowid);
 economy.applyWalletTransaction({steamId:A,amount:500,kind:'fixture',reason:'Synthetic funding',idempotencyKey:'fixture:'+n});treasury.donate({steamId:A,groupId,amount:200,requestId:'funding_'+n});
 const item={id:'entry-'+n,revision:1,title:'Synthetic entry '+n,description:'Test price only',cost:80,purpose:'territory_entry',target:{eventId}};spending.register(item,A);spending.setEnabled(item.id,1,true,A);
 const draft=await request(A,'/purchases',{expectedGroupId:groupId,itemId:item.id,revision:1,expectedCost:80,requestId:'client_entry_'+n});assert.equal(draft.status,200);
 const id=draft.body.requestId;
 return {A,B,groupId,territoryGroupId,eventId,item,id,draft:draft.body,
  act:(action,actor=A,extra={})=>request(actor,`/purchases/${id}/${action}`,{expectedGroupId:groupId,...(action==='confirm'?{confirmed:true}:{}),...extra}),
  registered:()=>db.prepare('SELECT * FROM territory_event_registrations WHERE event_id=? AND group_id=?').get(eventId,territoryGroupId)};
}
async function held(){for(let index=0;index<200;index++){if(release)return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('No held request');}
test('owner review binds actual group/event; explicit confirmation performs one registration and charge',async()=>{
 const f=await fixture();assert.equal(f.draft.state,'draft');assert.equal(f.draft.fulfillment.territoryGroupId,f.territoryGroupId);assert.equal(f.draft.fulfillment.eventId,f.eventId);assert.equal(treasury.get(f.groupId).held,0);
 assert.equal((await f.act('confirm',f.B)).status,403);assert.equal((await f.act('confirm',f.A,{confirmed:false})).status,400);
 const result=await f.act('confirm',f.A,{actorSteamId:f.B,expectedCost:1,fulfillment:{territoryGroupId:999}});assert.equal(result.body.state,'committed');assert.ok(f.registered());assert.equal(treasury.get(f.groupId).balance,120);
 assert.equal((await f.act('confirm')).body.state,'committed');assert.equal((await f.act('release')).body.state,'committed');assert.equal(treasury.get(f.groupId).balance,120);
 assert.equal(JSON.stringify(result.body).includes('signature'),false);
});
test('lost dispatch reply leaves a recoverable hold; status alone cannot register',async()=>{
 const f=await fixture();drop='dispatch';const result=await f.act('confirm');assert.equal(result.body.state,'reserved');assert.equal(f.registered(),undefined);assert.equal(treasury.get(f.groupId).held,80);
 const before=calls.dispatch;assert.equal((await f.act('reconcile')).body.state,'reserved');assert.equal(calls.dispatch,before);assert.equal(f.registered(),undefined);
 assert.equal((await f.act('confirm')).body.state,'committed');assert.equal(calls.dispatch,before);assert.ok(f.registered());
});
test('lost settlement reply recovers accepted registration without repeating delivery or charge',async()=>{
 const f=await fixture();drop='settle';assert.equal((await f.act('confirm')).body.state,'reserved');assert.ok(f.registered());assert.equal(treasury.get(f.groupId).balance,120);
 assert.equal((await f.act('reconcile')).body.state,'committed');assert.equal(treasury.get(f.groupId).balance,120);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM territory_event_log WHERE event_id=? AND kind='registration'").get(f.eventId).n,1);
});
test('cancellation overtakes reservation before preparation and blocks late delivery',async()=>{
 const f=await fixture();hold='reserve';const confirming=f.act('confirm');await held();assert.equal((await f.act('release')).body.state,'released');release();assert.equal((await confirming).body.state,'released');
 assert.equal(f.registered(),undefined);assert.equal(treasury.get(f.groupId).balance,200);assert.equal(treasury.get(f.groupId).held,0);
 assert.equal(db.prepare('SELECT outcome FROM hv_treasury_territory_delivery WHERE request_id=?').get(f.id).outcome,'not_delivered');
});
test('cancellation overtakes dispatch and its immutable non-delivery outcome prevents registration',async()=>{
 const f=await fixture();hold='dispatch';const confirming=f.act('confirm');await held();assert.equal((await f.act('release')).body.state,'released');release();await confirming;
 assert.equal(f.registered(),undefined);assert.equal(treasury.get(f.groupId).balance,200);assert.equal(treasury.get(f.groupId).held,0);
});
test('successor owner can cancel during delayed dispatch; former owner cannot finish or redirect',async()=>{
 const f=await fixture();hold='dispatch';const confirming=f.act('confirm');await held();groups.exitGroup(f.A);
 assert.equal((await f.act('release',f.B)).body.state,'released');release();assert.equal((await confirming).status,404);assert.equal((await f.act('confirm')).status,404);
 assert.equal(f.registered(),undefined);assert.equal(treasury.get(f.groupId).balance,200);
});
test('changed reviewed link or ended event retains the saved request for cancellation',async()=>{
 const f=await fixture();links.set(f.A,{expectedGroupId:f.groupId,expectedRevision:1,territoryGroupId:null});
 const pending=await f.act('confirm');assert.equal(pending.body.state,'reserved');assert.equal(pending.body.lastErrorCode,'ENTRY_LINK_REQUIRED');assert.equal(f.registered(),undefined);
 assert.equal((await f.act('release')).body.state,'released');
 const g=await fixture();db.prepare("UPDATE territory_events SET status='ended' WHERE id=?").run(g.eventId);
 assert.equal((await g.act('confirm')).body.lastErrorCode,'ENTRY_EVENT_UNAVAILABLE');assert.equal((await g.act('release')).body.state,'released');assert.equal(g.registered(),undefined);
});
test('pausing entry preserves dispatched recovery and release, while status never begins delivery',async()=>{
 const f=await fixture();drop='dispatch';await f.act('confirm');process.env.GROUP_TREASURY_TERRITORY_ENABLED='0';
 try{assert.equal((await f.act('confirm')).body.state,'reserved');assert.equal((await f.act('reconcile')).body.state,'reserved');assert.equal(f.registered(),undefined);assert.equal((await f.act('release')).body.state,'released');}finally{process.env.GROUP_TREASURY_TERRITORY_ENABLED='1';}
});
test('parallel confirmations reuse a single effect, proof and group-ledger debit',async()=>{
 const f=await fixture();const responses=await Promise.all([f.act('confirm'),f.act('confirm')]);assert.ok(responses.every(value=>value.status===200));
 assert.equal((await f.act('reconcile')).body.state,'committed');assert.equal(treasury.get(f.groupId).balance,120);
 assert.equal(economy.db.prepare('SELECT COUNT(*) n FROM economy_group_treasury_ledger WHERE spend_request_id=?').get(f.id).n,1);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM hv_treasury_territory_delivery_audit WHERE request_id=? AND outcome='delivered'").get(f.id).n,1);
});
test('dormant Territory runtime hides new entries even if historical Territory tables exist',async()=>{
 const f=await fixture();process.env.TERRITORY_WARS_ADMIN_TEST_ENABLED='0';
 try{
  assert.equal((await request(f.A,'/capabilities')).body.territoryEntryEnabled,false);
  assert.equal((await request(f.A,'/spending')).body.catalog.some(item=>item.purpose==='territory_entry'),false);
  assert.equal((await f.act('confirm')).status,503);assert.equal(f.registered(),undefined);assert.equal(treasury.get(f.groupId).held,0);
  assert.equal((await f.act('release')).body.state,'released');assert.equal(treasury.get(f.groupId).balance,200);
 }finally{process.env.TERRITORY_WARS_ADMIN_TEST_ENABLED='1';}
});
