const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),express=require('express');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hv-event-owner-'));
process.env.DB_PATH=path.join(temp,'website.sqlite');process.env.AUTOMATION_DB_PATH=path.join(temp,'economy.sqlite');
process.env.GROUP_TREASURY_ENABLED='1';process.env.GROUP_TREASURY_SPEND_ENABLED='1';process.env.GROUP_TREASURY_EVENT_ENABLED='1';process.env.HOLLOW_VALLEY_API_TOKEN='synthetic-group-event-owner-token';
for(const name of ['GROUP_TREASURY_READ_ONLY','SKIN_STUDIO_READ_ONLY','RENDER_SERVICE_ID','RENDER_EXTERNAL_URL','PUBLIC_SITE_URL','STEAM_REALM','STEAM_RETURN_URL'])delete process.env[name];
const {db}=require('../server/db'),groups=require('../server/groupsStore'),economy=require('../automation-platform/src/services/economyStore');
const feed=require('../automation-platform/src/services/discordEventService'),automationStore=require('../automation-platform/src/services/automationStore');
const treasury=require('../automation-platform/src/services/groupTreasuryService').createGroupTreasury(economy),spending=require('../automation-platform/src/services/groupTreasurySpending').createGroupTreasurySpending(economy);
let autoServer,webServer,base,drop=null,hold=null,release=null,wrongEvent=false;
const calls={reserve:0,commit:0};
test.before(async()=>{
 const auto=express();auto.use(express.json());auto.use((req,res,next)=>{
  const action=req.path.endsWith('/spend-reserve')?'reserve':req.path.endsWith('/spend-commit')?'commit':req.path.endsWith('/group-event-registrations')?'history':req.path.endsWith('/group-event-preview')?'preview':null;
  if(action in calls)calls[action]++;
  if(drop&&drop===action){drop=null;res.json=()=>{res.destroy();return res;};}
  if(action==='commit'&&wrongEvent){wrongEvent=false;const json=res.json.bind(res);res.json=body=>json({...body,event:{...body.event,eventName:'Wrong returned event'}});}
  if(action&&hold===action){hold=null;release=()=>{release=null;next();};return;}next();
 });auto.use('/api/website/group-treasury',require('../automation-platform/src/routes/websiteGroupTreasuryRoutes'));
 autoServer=await new Promise(resolve=>{const value=auto.listen(0,'127.0.0.1',()=>resolve(value));});process.env.AUTOMATION_SERVICE_URL='http://127.0.0.1:'+autoServer.address().port;
 const web=express();web.use(express.json());web.use((req,res,next)=>{if(req.get('x-user'))req.user={steam_id:req.get('x-user')};next();});web.use('/api/group-treasury',require('../server/routes/groupTreasury'));
 webServer=await new Promise(resolve=>{const value=web.listen(0,'127.0.0.1',()=>resolve(value));});base='http://127.0.0.1:'+webServer.address().port;
});
test.after(async()=>{if(release)release();await Promise.all([autoServer,webServer].map(server=>new Promise(resolve=>server.close(resolve))));automationStore.close();db.close();economy.db.close();const target=path.resolve(temp);assert.ok(target.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(target,{recursive:true,force:true});});
async function request(actor,url,body,origin=base){const response=await fetch(base+'/api/group-treasury'+url,{method:body?'POST':'GET',headers:{'x-user':actor||'',Origin:origin,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json(),cache:response.headers.get('cache-control')};}
let n=0;
async function fixture(){
 n++;const A=String(76561198000015000n+BigInt(n*10)),B=String(BigInt(A)+1n);
 for(const actor of [A,B])db.prepare('INSERT INTO users(steam_id,username) VALUES(?,?)').run(actor,'Synthetic event member');
 const groupId=groups.createGroup(A,'Group Event '+n).current.id;groups.invite(A,B);groups.actOnInvite(B,groups.getState(B).incoming[0].id,'accept');
 economy.applyWalletTransaction({steamId:A,amount:500,kind:'fixture',reason:'Synthetic event funds',idempotencyKey:'fixture:'+n});treasury.donate({steamId:A,groupId,amount:200,requestId:'event_fund_'+n});
 const eventId=String(1540359454627740000n+BigInt(n)),raw={id:eventId,title:'Event '+n+' <img src=x>',status:'scheduled',startTime:new Date(Date.now()+3600000).toISOString(),endTime:null};
 const sync=(change={})=>feed.syncEvents({guildId:'1540359454627725387',events:[{...raw,...change}]});sync();
 const item={id:'event-entry-'+n,revision:1,title:'Group event entry '+n,description:'Synthetic reviewed price',cost:80,purpose:'event_registration',target:{eventId}};
 spending.register(item,A);spending.setEnabled(item.id,1,true,A);
 const prepare=()=>request(A,'/purchases',{expectedGroupId:groupId,itemId:item.id,revision:1,expectedCost:80,requestId:'event_client_'+n,event:{eventId:'forged'},actorSteamId:B});
 const draft=await prepare();assert.equal(draft.status,200);const id=draft.body.requestId;
 return {A,B,groupId,eventId,item,id,draft:draft.body,raw,sync,
  act:(action,actor=A,extra={})=>request(actor,`/purchases/${id}/${action}`,{expectedGroupId:groupId,...(action==='confirm'?{confirmed:true}:{}),...extra}),
  registrations:()=>economy.db.prepare('SELECT * FROM economy_group_event_registrations WHERE group_id=?').all(groupId)};
}
async function held(){for(let i=0;i<200;i++){if(release)return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('No held request');}
test('owner review binds trusted event and price; members cannot confirm, and forged body fields are ignored',async()=>{
 const f=await fixture();assert.equal(f.draft.fulfillment.eventId,f.eventId);assert.equal(f.draft.fulfillment.eventName,f.raw.title);assert.equal(treasury.get(f.groupId).held,0);
 assert.equal((await f.act('confirm',f.B)).status,403);assert.equal((await f.act('confirm',f.A,{confirmed:false})).status,400);
 assert.equal((await f.act('confirm',f.A,{event:{eventId:'forged'},expectedCost:1,actorSteamId:f.B})).body.state,'committed');assert.equal(f.registrations()[0].event_id,f.eventId);assert.equal(treasury.get(f.groupId).balance,120);
 assert.equal((await f.act('confirm')).body.state,'committed');
});
test('renamed or rescheduled event cannot silently replace the reviewed draft',async()=>{
 const f=await fixture();f.sync({title:'Changed after review'});const result=await f.act('confirm');assert.equal(result.body.state,'submitted');assert.equal(result.body.lastErrorCode,'GROUP_EVENT_CHANGED');assert.equal(treasury.get(f.groupId).held,0);
 assert.equal((await f.act('release')).body.state,'released');assert.equal(f.registrations().length,0);
});
test('event changes after lost reservation reply leave only an uncommitted cancellable hold',async()=>{
 const f=await fixture();drop='reserve';assert.equal((await f.act('confirm')).body.state,'submitted');f.sync({startTime:new Date(Date.now()+7200000).toISOString()});
 assert.equal((await f.act('reconcile')).body.state,'reserved');assert.equal((await f.act('confirm')).body.lastErrorCode,'GROUP_EVENT_CHANGED');assert.equal(f.registrations().length,0);assert.equal(treasury.get(f.groupId).held,80);
 assert.equal((await f.act('release')).body.state,'released');assert.equal(treasury.get(f.groupId).balance,200);
});
test('lost commit reply recovers one registration and charge; history is private and current-member scoped',async()=>{
 const f=await fixture();drop='commit';assert.equal((await f.act('confirm')).body.state,'reserved');assert.equal((await f.act('reconcile')).body.state,'committed');assert.equal(f.registrations().length,1);assert.equal(treasury.get(f.groupId).balance,120);
 const history=await request(f.B,'/event-registrations?groupId=999999');assert.equal(history.cache,'private, no-store');assert.equal(history.body.groupId,f.groupId);assert.equal(history.body.registrations[0].eventId,f.eventId);assert.equal(JSON.stringify(history.body).includes(f.A),false);
 assert.equal((await request(null,'/event-registrations')).status,401);
});
test('successor owner can cancel while commit is delayed; former owner cannot finish',async()=>{
 const f=await fixture();hold='commit';const confirming=f.act('confirm');await held();groups.exitGroup(f.A);
 assert.equal((await f.act('release',f.B)).body.state,'released');release();assert.equal((await confirming).status,404);assert.equal(f.registrations().length,0);assert.equal(treasury.get(f.groupId).balance,200);
});
test('history checks membership again after a delayed remote read',async()=>{
 const f=await fixture();await f.act('confirm');hold='history';const reading=request(f.B,'/event-registrations');await held();groups.exitGroup(f.B);groups.createGroup(f.B,'Replacement '+n);release();
 const result=await reading;assert.equal(result.status,404);assert.equal(JSON.stringify(result.body).includes(f.raw.title),false);
});
test('paused group event rollout blocks new confirmation while preserving release and history',async()=>{
 const f=await fixture();process.env.GROUP_TREASURY_EVENT_ENABLED='0';
 try{assert.equal((await f.act('confirm')).status,503);assert.equal(treasury.get(f.groupId).held,0);assert.equal((await f.act('release')).body.state,'released');assert.equal((await request(f.A,'/event-registrations')).status,200);assert.equal((await request(f.A,'/spending')).body.catalog.some(item=>item.purpose==='event_registration'),false);}finally{process.env.GROUP_TREASURY_EVENT_ENABLED='1';}
});
test('mismatched event receipt stays pending until authoritative recovery, without another charge',async()=>{
 const f=await fixture();wrongEvent=true;const result=await f.act('confirm');assert.equal(result.body.state,'reserved');assert.equal(result.body.lastErrorCode,'SPEND_RESPONSE_MISMATCH');assert.equal(treasury.get(f.groupId).balance,120);
 assert.equal((await f.act('reconcile')).body.state,'committed');assert.equal(treasury.get(f.groupId).balance,120);assert.equal(f.registrations().length,1);
});
test('ownership lost during event preview cannot create a draft for the former owner',async()=>{
 const f=await fixture();await f.act('release');hold='preview';
 const preparing=request(f.A,'/purchases',{expectedGroupId:f.groupId,itemId:f.item.id,revision:1,expectedCost:80,requestId:'after_preview_'+n});
 await held();groups.exitGroup(f.A);release();assert.equal((await preparing).status,404);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM hv_group_treasury_purchases WHERE group_id=?').get(f.groupId).n,1);assert.equal(treasury.get(f.groupId).held,0);
});
