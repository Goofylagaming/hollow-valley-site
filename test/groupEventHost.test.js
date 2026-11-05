const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),express=require('express');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hv-event-host-'));
process.env.DB_PATH=path.join(temp,'website.sqlite');process.env.AUTOMATION_DB_PATH=path.join(temp,'economy.sqlite');process.env.GROUP_TREASURY_ENABLED='1';process.env.GROUP_TREASURY_SPEND_ENABLED='1';process.env.GROUP_TREASURY_EVENT_ENABLED='1';process.env.HOLLOW_VALLEY_API_TOKEN='synthetic-host-roster-token';
const {db}=require('../server/db'),groups=require('../server/groupsStore'),economy=require('../automation-platform/src/services/economyStore'),feed=require('../automation-platform/src/services/discordEventService'),automationStore=require('../automation-platform/src/services/automationStore');
const registry=require('../automation-platform/src/services/groupEventRegistration').createGroupEventRegistration(economy.db),spending=require('../automation-platform/src/services/groupTreasurySpending').createGroupTreasurySpending(economy,{groupEvents:registry}),treasury=require('../automation-platform/src/services/groupTreasuryService').createGroupTreasury(economy);
const STAFF='76561198000017000',MEMBER='76561198000017001';
for(const actor of [STAFF,MEMBER])db.prepare('INSERT INTO users(steam_id,username,is_admin) VALUES(?,?,?)').run(actor,'Synthetic staff',Number(actor===STAFF));
let autoServer,webServer,base,n=0,hold=false,release=null,wrong=false,calls=0;
test.before(async()=>{
 const auto=express();auto.use(express.json());auto.use((req,res,next)=>{if(req.path.endsWith('/group-event-roster')){
  calls++;if(wrong){wrong=false;const json=res.json.bind(res);res.json=body=>json({...body,eventId:'999999999999999999'});}
  if(hold){hold=false;release=()=>{release=null;next();};return;}
 }next();});auto.use('/api/website/group-treasury',require('../automation-platform/src/routes/websiteGroupTreasuryRoutes'));
 autoServer=await new Promise(resolve=>{const value=auto.listen(0,'127.0.0.1',()=>resolve(value));});process.env.AUTOMATION_SERVICE_URL='http://127.0.0.1:'+autoServer.address().port;
 const web=express();web.use((req,res,next)=>{req.user=db.prepare('SELECT * FROM users WHERE steam_id=?').get(req.get('x-user')||'');next();});web.use('/api/events',require('../server/routes/events'));
 webServer=await new Promise(resolve=>{const value=web.listen(0,'127.0.0.1',()=>resolve(value));});base='http://127.0.0.1:'+webServer.address().port;
});
test.after(async()=>{if(release)release();await Promise.all([autoServer,webServer].map(server=>new Promise(resolve=>server.close(resolve))));automationStore.close();db.close();economy.db.close();const target=path.resolve(temp);assert.ok(target.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(target,{recursive:true,force:true});});
async function request(path='',actor=STAFF){const response=await fetch(base+'/api/events/admin/group-registrations'+path,{headers:{'x-user':actor}});return {status:response.status,body:await response.json(),cache:response.headers.get('cache-control')};}
function seed(eventId='1540359454627760001',{commit=true}={}){
 n++;const actor=String(76561198000017100n+BigInt(n));db.prepare('INSERT INTO users(steam_id,username) VALUES(?,?)').run(actor,'Synthetic owner');const groupId=groups.createGroup(actor,'Roster Group '+n+' <img src=x>').current.id;
 const raw={id:eventId,title:'Host Event '+eventId,status:'scheduled',startTime:new Date(Date.now()+3600000).toISOString(),endTime:null};feed.syncEvents({guildId:'1540359454627725387',events:[raw]});
 economy.applyWalletTransaction({steamId:actor,amount:500,kind:'fixture',reason:'Synthetic host funding',idempotencyKey:'host:'+n});treasury.donate({steamId:actor,groupId,amount:200,requestId:'host_donate_'+n});
 const item={id:'host-entry-'+n,revision:1,title:'Synthetic entry',description:'Test price',cost:80,purpose:'event_registration',target:{eventId}};spending.register(item,actor);spending.setEnabled(item.id,1,true,actor);
 const input={groupId,requestId:'host_purchase_'+n,actorSteamId:actor,itemId:item.id,revision:1,expectedCost:80,event:registry.preview(eventId)};spending.reserve(input);if(commit)spending.commit(input);
 return {actor,groupId,eventId,input};
}
test('host roster and event discovery require current staff access and use private cache headers',async()=>{
 const f=seed();for(const path of ['/events','?eventId='+f.eventId]){assert.equal((await request(path,'')).status,401);assert.equal((await request(path,MEMBER)).status,403);const admin=await request(path);assert.equal(admin.status,200);assert.equal(admin.cache,'private, no-store');}
});
test('roster joins current group names and status, strips Steam/request identities, and supports deterministic pages',async()=>{
 const id='1540359454627760002',a=seed(id),b=seed(id),c=seed(id);db.prepare("UPDATE hv_groups SET status='closed' WHERE id=?").run(b.groupId);
 const first=await request('?eventId='+id+'&limit=2');assert.equal(first.status,200);assert.deepEqual(first.body.registrations.map(row=>row.groupId),[a.groupId,b.groupId]);assert.equal(first.body.nextGroupId,b.groupId);assert.equal(first.body.registrations[1].groupStatus,'closed');assert.match(first.body.registrations[0].groupName,/Roster Group/);
 const next=await request('?eventId='+id+'&limit=2&afterGroupId='+first.body.nextGroupId);assert.deepEqual(next.body.registrations.map(row=>row.groupId),[c.groupId]);assert.equal(next.body.nextGroupId,null);
 const json=JSON.stringify(first.body);assert.equal(json.includes(a.actor),false);assert.equal(json.includes(a.input.requestId),false);
});
test('historical discovery includes registered events with cursor pagination but excludes uncommitted holds',async()=>{
 const a=seed('1540359454627760003'),pending=seed('1540359454627760004',{commit:false});
 const index=await request('/events?limit=1');assert.equal(index.status,200);assert.equal(index.body.events.length,1);assert.equal(index.body.nextEventId,index.body.events[0].eventId);
 const next=await request('/events?afterEventId='+index.body.nextEventId+'&limit=100');assert.ok(next.body.events.some(event=>event.eventId===a.eventId));assert.equal(next.body.events.some(event=>event.eventId===pending.eventId),false);
});
test('invalid event/cursor/page inputs are rejected before contacting accounting',async()=>{
 const before=calls;for(const query of ['?eventId=bad','?eventId=1540359454627760002&limit=101','?eventId=1540359454627760002&afterGroupId=-1','?eventId=1540359454627760002&limit=1.5'])assert.equal((await request(query)).status,400);
 assert.equal(calls,before);assert.equal((await request('/events?afterEventId=bad')).status,400);
});
test('revoking staff access during a remote roster read prevents disclosure',async()=>{
 const f=seed('1540359454627760005');hold=true;const reading=request('?eventId='+f.eventId);
 for(let i=0;i<200&&!release;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(release);
 db.prepare('UPDATE users SET is_admin=0 WHERE steam_id=?').run(STAFF);release();
 try{const result=await reading;assert.equal(result.status,403);assert.equal(JSON.stringify(result.body).includes('Roster Group'),false);}finally{db.prepare('UPDATE users SET is_admin=1 WHERE steam_id=?').run(STAFF);}
});
test('historical rosters remain readable after rollout is paused and the event is hidden, without writes',async()=>{
 const f=seed('1540359454627760006');feed.hideEventFromWebsite(f.eventId);process.env.GROUP_TREASURY_EVENT_ENABLED='0';
 const before=economy.db.prepare('SELECT COUNT(*) n FROM economy_group_treasury_ledger').get().n;
 try{const result=await request('?eventId='+f.eventId);assert.equal(result.status,200);assert.equal(result.body.registrations.length,1);assert.equal(economy.db.prepare('SELECT COUNT(*) n FROM economy_group_treasury_ledger').get().n,before);}finally{process.env.GROUP_TREASURY_EVENT_ENABLED='1';}
});
test('a mismatched accounting roster cannot be shown as the selected event',async()=>{
 const f=seed('1540359454627760007');wrong=true;const result=await request('?eventId='+f.eventId);assert.equal(result.status,502);assert.equal('registrations' in result.body,false);
});
test('missing committed evidence is an error rather than an empty or successful host roster',async()=>{
 const f=seed('1540359454627760008');economy.db.prepare('DELETE FROM economy_group_event_registration_audit WHERE request_id=?').run(f.input.requestId);
 const result=await request('?eventId='+f.eventId);assert.equal(result.status,500);assert.equal('registrations' in result.body,false);assert.equal(treasury.get(f.groupId).balance,120);
});
