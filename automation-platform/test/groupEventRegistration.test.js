const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),express=require('express');
const {spawn}=require('node:child_process');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hv-group-event-'));
process.env.AUTOMATION_DB_PATH=path.join(temp,'automation.sqlite');
process.env.GROUP_TREASURY_ENABLED='1';process.env.GROUP_TREASURY_SPEND_ENABLED='1';process.env.GROUP_TREASURY_EVENT_ENABLED='1';process.env.HOLLOW_VALLEY_API_TOKEN='synthetic-group-event-token';
const economy=require('../src/services/economyStore'),db=economy.db;
const feed=require('../src/services/discordEventService'),automationStore=require('../src/services/automationStore');
const {createGroupEventRegistration}=require('../src/services/groupEventRegistration');
const events=createGroupEventRegistration(db);
const {createGroupTreasurySpending}=require('../src/services/groupTreasurySpending');
const spending=createGroupTreasurySpending(economy,{groupEvents:events});
const treasury=require('../src/services/groupTreasuryService').createGroupTreasury(economy);
const A='76561198000000001',B='76561198000000002',guildId='1540359454627725387';
let server,base,drop=false,n=0,syncClock=0;
test.before(async()=>{const app=express();app.use(express.json());app.use((req,res,next)=>{if(drop&&req.path.endsWith('/spend-commit')){drop=false;res.json=()=>{res.destroy();return res;};}next();});app.use('/api/website/group-treasury',require('../src/routes/websiteGroupTreasuryRoutes'));server=await new Promise(resolve=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));});base='http://127.0.0.1:'+server.address().port;});
test.after(async()=>{await new Promise(resolve=>server.close(resolve));automationStore.close();db.close();const target=path.resolve(temp);assert.ok(target.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(target,{recursive:true,force:true});});
function fixture(){
 n++;const groupId=n,eventId=String(1540359454627730000n+BigInt(n)),requestId='group_event_'+n;
 const raw={id:eventId,title:'Synthetic group event '+n,status:'scheduled',startTime:new Date(Date.now()+3600000).toISOString(),endTime:new Date(Date.now()+7200000).toISOString()};
 const sync=(change={})=>{syncClock=Math.max(Date.now(),syncClock+1);return feed.syncEvents({guildId,events:[{...raw,...change}],syncedAt:new Date(syncClock).toISOString()});};sync();
 const stale=()=>{const current=automationStore.getState('discord:scheduled-events').value;automationStore.setState('discord:scheduled-events',{...current,syncedAt:new Date(Date.now()-3600000).toISOString()});};
 economy.applyWalletTransaction({steamId:A,amount:500,kind:'fixture',reason:'Synthetic event funding',idempotencyKey:'eventfund:'+n});treasury.donate({steamId:A,groupId,amount:200,requestId:'event_donation_'+n});
 const item={id:'group-event-'+n,revision:1,title:'Synthetic paid group entry',description:'Test-only price',cost:80,purpose:'event_registration',target:{eventId}};
 spending.register(item,A);spending.setEnabled(item.id,1,true,A);
 const input={groupId,requestId,actorSteamId:A,itemId:item.id,revision:1,expectedCost:80,event:events.preview(eventId)};
 return {groupId,eventId,requestId,item,input,sync,stale,raw,reserve:()=>spending.reserve(input),commit:()=>spending.commit({groupId,requestId,actorSteamId:A}),release:()=>spending.release(input),
   registrations:()=>db.prepare('SELECT * FROM economy_group_event_registrations WHERE group_id=?').all(groupId)};
}
const code=value=>error=>error.code===value;
test('event descriptors validate full canonical identity, schedule and fingerprint without depending on field order',()=>{
 const f=fixture(),validate=require('../src/services/groupEventRegistration').validateDescriptor;
 assert.deepEqual(validate(Object.fromEntries(Object.entries(f.input.event).reverse())),f.input.event);
 for(const change of [{revision:'0'.repeat(64)},{extra:true},{eventName:'Unsafe\nname'},{eventId:'unknown'},{startTime:'2099-01-01'},{endTime:'2000-01-01T00:00:00.000Z'}])assert.throws(()=>validate({...f.input.event,...change}),code('GROUP_EVENT_CHANGED'));
});
async function rpc(action,body,token=process.env.HOLLOW_VALLEY_API_TOKEN){const response=await fetch(base+'/api/website/group-treasury/'+action,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};}
test('group registration requires fresh explicit scheduled status; old unknown, active and hidden events cannot authorize entry',()=>{
 const f=fixture();assert.equal(events.preview(f.eventId).eventId,f.eventId);
 for(const status of [undefined,'active','completed','cancelled']){f.sync({status});assert.throws(()=>events.preview(f.eventId),code('GROUP_EVENT_UNAVAILABLE'));}
 f.sync();feed.hideEventFromWebsite(f.eventId);assert.throws(()=>events.preview(f.eventId),code('GROUP_EVENT_UNAVAILABLE'));
 f.stale();assert.throws(()=>events.preview(f.eventId),code('GROUP_EVENT_FEED_UNAVAILABLE'));
 // Consumers still reject a pre-existing future-dated cache independently of
 // the ingestion guard that now prevents accepting such a new snapshot.
 const cached=automationStore.getState('discord:scheduled-events').value;automationStore.setState('discord:scheduled-events',{...cached,syncedAt:new Date(Date.now()+120000).toISOString()});assert.throws(()=>events.preview(f.eventId),code('GROUP_EVENT_FEED_UNAVAILABLE'));
 automationStore.setState('discord:scheduled-events',cached);
});
test('review snapshot and event identity are immutable consent data before reserving coins',()=>{
 const f=fixture();assert.throws(()=>spending.reserve({...f.input,event:undefined}),code('GROUP_EVENT_CHANGED'));
 assert.throws(()=>spending.reserve({...f.input,event:{...f.input.event,eventName:'Forged'}}),code('GROUP_EVENT_CHANGED'));
 assert.equal(treasury.get(f.groupId).held,0);const result=f.reserve();assert.deepEqual(result.event,f.input.event);
 assert.throws(()=>spending.reserve({...f.input,event:{...f.input.event,startTime:'2099-01-01T00:00:00.000Z'}}),code('SPEND_CONFLICT'));
 assert.equal(treasury.get(f.groupId).held,80);
});
test('registration, audit and one charge commit together without attendance or reward writes',()=>{
 const f=fixture();f.reserve();const wallet=economy.getWallet(A).balance;
 const before=db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%attendance%' OR name LIKE '%reward%'").all();
 assert.equal(f.commit().state,'committed');assert.equal(f.commit().state,'committed');
 assert.equal(f.registrations().length,1);assert.equal(f.registrations()[0].request_id,f.requestId);assert.equal(treasury.get(f.groupId).balance,120);assert.equal(treasury.get(f.groupId).held,0);assert.equal(economy.getWallet(A).balance,wallet);
 assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%attendance%' OR name LIKE '%reward%'").all(),before);
 assert.equal(f.release().state,'committed');assert.equal(treasury.get(f.groupId).balance,120);
});
test('reschedule, changed title, event start and hidden events block charge while preserving cancellable holds',()=>{
 for(const change of [{title:'Updated title'},{startTime:new Date(Date.now()+10800000).toISOString(),endTime:new Date(Date.now()+14400000).toISOString()},{startTime:new Date(Date.now()-1000).toISOString()}]){
  const f=fixture();f.reserve();f.sync(change);assert.throws(f.commit,error=>['GROUP_EVENT_CHANGED','GROUP_EVENT_NOT_OPEN'].includes(error.code));assert.equal(f.registrations().length,0);assert.equal(treasury.get(f.groupId).balance,200);assert.equal(f.release().state,'released');
 }
 const f=fixture();f.reserve();feed.hideEventFromWebsite(f.eventId);assert.throws(f.commit,code('GROUP_EVENT_UNAVAILABLE'));assert.equal(f.release().state,'released');
});
test('stale feed blocks new effects but does not prevent cancellation or committed receipt recovery',()=>{
 const f=fixture();f.reserve();f.stale();assert.throws(f.commit,code('GROUP_EVENT_FEED_UNAVAILABLE'));assert.equal(f.release().state,'released');
 const g=fixture();g.reserve();g.commit();g.stale();assert.equal(g.commit().state,'committed');assert.equal(events.list(g.groupId).length,1);
});
test('registration audit or accounting audit failure rolls back both benefit and charge',()=>{
 for(const table of ['economy_group_event_registration_audit','economy_group_treasury_spend_audit']){
  const f=fixture();f.reserve();db.exec(`CREATE TRIGGER reject_event BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END`);
  try{assert.throws(f.commit,/synthetic audit failure/);assert.equal(f.registrations().length,0);assert.equal(treasury.get(f.groupId).balance,200);assert.equal(treasury.get(f.groupId).held,80);}finally{db.exec('DROP TRIGGER reject_event');}
  assert.equal(f.commit().state,'committed');
 }
});
test('one group cannot acquire the same event twice under another catalog item',()=>{
 const f=fixture();f.reserve();f.commit();const item={...f.item,id:f.item.id+'-alias'};spending.register(item,A);spending.setEnabled(item.id,1,true,A);
 assert.throws(()=>spending.reserve({...f.input,itemId:item.id,requestId:f.requestId+'_alias'}),code('BENEFIT_ALREADY_RESERVED'));assert.equal(f.registrations().length,1);
});
test('missing committed registration, audit or ledger evidence fails closed without replacement debit',()=>{
 for(const table of ['economy_group_event_registrations','economy_group_event_registration_audit','economy_group_treasury_ledger']){
  const f=fixture();f.reserve();f.commit();const key=table==='economy_group_treasury_ledger'?'spend_request_id':'request_id';db.prepare(`DELETE FROM ${table} WHERE ${key}=?`).run(f.requestId);
  assert.throws(f.commit,code('TREASURY_INTEGRITY_ERROR'));assert.throws(()=>events.list(f.groupId),code('TREASURY_INTEGRITY_ERROR'));assert.equal(db.prepare('SELECT balance FROM economy_group_treasuries WHERE group_id=?').get(f.groupId).balance,120);
 }
});
test('group event flag pauses reservations and effects but retains release and stored receipts',()=>{
 const f=fixture();f.reserve();process.env.GROUP_TREASURY_EVENT_ENABLED='0';
 try{assert.throws(f.commit,code('GROUP_EVENT_DISABLED'));assert.equal(f.release().state,'released');assert.throws(()=>events.preview(f.eventId),code('GROUP_EVENT_DISABLED'));}finally{process.env.GROUP_TREASURY_EVENT_ENABLED='1';}
});
test('independent commit/release processes settle exactly one benefit and debit or release',async()=>{
 const f=fixture();f.reserve();
 const source=`const economy=require(process.env.EVENT_TEST_ECONOMY);const events=require(process.env.EVENT_TEST_REGISTRY).createGroupEventRegistration(economy.db);const spending=require(process.env.EVENT_TEST_SPENDING).createGroupTreasurySpending(economy,{groupEvents:events});try{const input=JSON.parse(process.env.EVENT_TEST_INPUT);process.stdout.write(JSON.stringify(process.env.EVENT_TEST_ACTION==='commit'?spending.commit(input):spending.release(input)));}catch(error){if(error.code==='SPEND_RELEASED')process.stdout.write(JSON.stringify({state:'released'}));else{process.stderr.write(error.stack);process.exitCode=1;}}finally{economy.db.close();}`;
 const run=action=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,['-e',source],{windowsHide:true,env:{...process.env,EVENT_TEST_ECONOMY:require.resolve('../src/services/economyStore'),EVENT_TEST_REGISTRY:require.resolve('../src/services/groupEventRegistration'),EVENT_TEST_SPENDING:require.resolve('../src/services/groupTreasurySpending'),EVENT_TEST_ACTION:action,EVENT_TEST_INPUT:JSON.stringify(f.input)}});let output='',errors='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>errors+=chunk);child.on('error',reject);child.on('close',status=>status?reject(new Error(errors)):resolve(JSON.parse(output)));});
 const results=await Promise.all([run('commit'),run('release')]);assert.equal(results[0].state,results[1].state);
 const committed=results[0].state==='committed';assert.equal(f.registrations().length,Number(committed));assert.equal(treasury.get(f.groupId).balance,committed?120:200);assert.equal(treasury.get(f.groupId).held,0);
});
test('private HTTP preview and registration read require token, bind price/event and recover lost commit reply',async()=>{
 const f=fixture();assert.equal((await rpc('group-event-preview',{eventId:f.eventId},'wrong')).status,401);
 assert.deepEqual((await rpc('group-event-preview',{eventId:f.eventId})).body,f.input.event);
 assert.equal((await rpc('spend-reserve',f.input)).status,200);drop=true;await assert.rejects(()=>rpc('spend-commit',f.input));
 assert.equal((await rpc('spend-status',f.input)).body.state,'committed');assert.equal((await rpc('spend-commit',f.input)).body.state,'committed');assert.equal(treasury.get(f.groupId).balance,120);
 const history=await rpc('group-event-registrations',{groupId:f.groupId});assert.equal(history.status,200);assert.equal(history.body.registrations.length,1);assert.equal(JSON.stringify(history.body).includes(A),false);
});
