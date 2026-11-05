const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),express=require('express');
const {chromium}=require('playwright');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hv-event-host-browser-'));
process.env.DB_PATH=path.join(temp,'website.sqlite');process.env.AUTOMATION_DB_PATH=path.join(temp,'economy.sqlite');process.env.GROUP_TREASURY_ENABLED='1';process.env.GROUP_TREASURY_SPEND_ENABLED='1';process.env.GROUP_TREASURY_EVENT_ENABLED='1';process.env.HOLLOW_VALLEY_API_TOKEN='synthetic-host-browser-token';
const {db}=require('../server/db'),groups=require('../server/groupsStore'),economy=require('../automation-platform/src/services/economyStore'),feed=require('../automation-platform/src/services/discordEventService'),automationStore=require('../automation-platform/src/services/automationStore');
const registry=require('../automation-platform/src/services/groupEventRegistration').createGroupEventRegistration(economy.db),spending=require('../automation-platform/src/services/groupTreasurySpending').createGroupTreasurySpending(economy,{groupEvents:registry}),treasury=require('../automation-platform/src/services/groupTreasuryService').createGroupTreasury(economy);
const STAFF='76561198000018000',MEMBER='76561198000018001',eventId='1540359454627770001';
for(const actor of [STAFF,MEMBER])db.prepare('INSERT INTO users(steam_id,username,is_admin) VALUES(?,?,?)').run(actor,'Synthetic staff',Number(actor===STAFF));
feed.syncEvents({guildId:'1540359454627725387',events:[{id:eventId,title:'Host Browser <img src=x>',status:'scheduled',startTime:new Date(Date.now()+3600000).toISOString(),endTime:null}]});
for(let index=1;index<=51;index++){
 const actor=String(76561198000018100n+BigInt(index));db.prepare('INSERT INTO users(steam_id,username) VALUES(?,?)').run(actor,'Synthetic owner');const groupId=groups.createGroup(actor,'Registered '+index+' <img src=x>').current.id;
 economy.applyWalletTransaction({steamId:actor,amount:500,kind:'fixture',reason:'Synthetic browser funding',idempotencyKey:'hostfund:'+index});treasury.donate({steamId:actor,groupId,amount:200,requestId:'host_donation_'+index});
 const item={id:'host-item-'+index,revision:1,title:'Synthetic entry',description:'Test price',cost:80,purpose:'event_registration',target:{eventId}};spending.register(item,actor);spending.setEnabled(item.id,1,true,actor);
 const input={groupId,requestId:'host_browser_'+index,actorSteamId:actor,itemId:item.id,revision:1,expectedCost:80,event:registry.preview(eventId)};spending.reserve(input);spending.commit(input);
}
const auto=express();auto.use(express.json());let failRoster=false,holdRoster=false,held=null,reads=0;
auto.use((req,res,next)=>{if(req.path.endsWith('/group-event-index')||req.path.endsWith('/group-event-roster'))reads++;
 if(req.path.endsWith('/group-event-roster')){if(failRoster)return res.status(503).json({error:'Group roster temporarily unavailable'});if(holdRoster){holdRoster=false;const json=res.json.bind(res);res.json=body=>{held=()=>{held=null;json(body);};return res;};}}next();});
auto.use('/api/website/group-treasury',require('../automation-platform/src/routes/websiteGroupTreasuryRoutes'));
const app=express();app.use((req,res,next)=>{const actor=String(req.headers.cookie||'').match(/fixture-account=(\d{17})/)?.[1];req.user=actor&&db.prepare('SELECT * FROM users WHERE steam_id=?').get(actor);next();});
app.get('/api/me',(req,res)=>res.json({loggedIn:Boolean(req.user),user:req.user||null,steamLoginConfigured:true}));
app.get('/api/events',(_req,res)=>res.json(feed.getEvents()));app.get('/api/events/species-bonuses',(_req,res)=>res.json({enabled:false,events:[]}));
app.get(['/api/events/rewards/mine','/api/events/admin/rewards'],(_req,res)=>res.json({rewards:[],state:{enabled:false}}));
app.get(['/api/events/attendance/mine','/api/events/admin/attendance'],(_req,res)=>res.json({attendance:[],state:{enabled:false}}));
app.get('/api/events/admin/players',(_req,res)=>res.json({players:[]}));
app.use('/api/events',require('../server/routes/events'));
process.env.DYNAMIC_CHALLENGES_EVENTS_ENABLED='0';
app.use('/api/admin/challenge-attendance',require('../server/routes/challengeAttendance').createRouter());
const unexpected=[];app.use('/api',(req,res)=>{unexpected.push(req.method+' '+req.path);res.status(404).json({error:'Unexpected fixture API'});});
app.get('/events',(_req,res)=>res.sendFile(path.join(__dirname,'../public/events.html')));app.use(express.static(path.join(__dirname,'../public')));
const listen=app=>new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
async function until(fn){for(let i=0;i<300;i++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Browser fixture wait timed out');}
(async()=>{
 let website,accounting,browser;
 try{
  accounting=await listen(auto);process.env.AUTOMATION_SERVICE_URL='http://127.0.0.1:'+accounting.address().port;website=await listen(app);const base='http://127.0.0.1:'+website.address().port;
  browser=await chromium.launch({headless:true,executablePath:process.env.HV_TEST_BROWSER||undefined});
  const ledgerBefore=economy.db.prepare('SELECT COUNT(*) n FROM economy_group_treasury_ledger').get().n;
  for(const width of [1440,390]){
   const context=await browser.newContext({viewport:{width,height:1000}});await context.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{document.body.dataset.suppressDailyClaim='true';}));
   await context.addCookies([{name:'fixture-account',value:STAFF,url:base}]);await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
   const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(base+'/events');
   await page.locator(`#group-roster-events option[value="${eventId}"]`).waitFor({state:'attached'});await page.selectOption('#group-roster-events',eventId);await page.click('#group-roster-load');
   await page.getByText('50 registered groups shown; more groups are available.',{exact:true}).waitFor();assert.equal(await page.locator('#group-roster-list li').count(),50);await page.click('#group-roster-more');
   await page.getByText('51 registered groups shown.',{exact:true}).waitFor();assert.equal(await page.locator('#group-roster-list li').count(),51);assert.equal(await page.locator('#group-roster-list img').count(),0);assert.equal(await page.locator('#event-group-roster img').count(),0);
   failRoster=true;await page.click('#group-roster-load');await page.getByText('Group roster temporarily unavailable',{exact:true}).waitFor();assert.equal(await page.locator('#group-roster-list li').count(),0);failRoster=false;
   holdRoster=true;await page.click('#group-roster-load');await until(()=>held);await page.fill('#group-roster-event-id','1540359454627770002');held();
   await page.click('#group-roster-load');await page.getByText('No recorded group registrations for this event.',{exact:true}).waitFor();assert.equal(await page.locator('#group-roster-list li').count(),0);
   await page.fill('#group-roster-event-id',eventId);await page.click('#group-roster-load');await page.getByText('50 registered groups shown; more groups are available.',{exact:true}).waitFor();
   assert.equal(await page.locator('#event-group-roster').evaluate(el=>el.getBoundingClientRect().right<=innerWidth+1),true);
   await context.clearCookies();await page.click('#group-roster-load');await page.waitForFunction(()=>document.getElementById('event-group-roster').hidden);assert.equal(await page.locator('#group-roster-list li').count(),0);
   const before=reads;await context.addCookies([{name:'fixture-account',value:MEMBER,url:base}]);await page.reload();await page.waitForFunction(()=>document.querySelector('#calendar-title').textContent!=='Loading calendar…');
   assert.equal(await page.locator('#event-group-roster').isVisible(),false);assert.equal(reads,before);assert.deepEqual(errors,[]);await context.close();
   console.log(`PASS ${width}px real Events host roster: 51 verified groups, pagination, safe text, unavailable/late reads, staff/session protection`);
  }
  assert.deepEqual(unexpected,[]);assert.equal(economy.db.prepare('SELECT COUNT(*) n FROM economy_group_treasury_ledger').get().n,ledgerBefore);
 }finally{if(held)held();if(browser)await browser.close();await Promise.all([website,accounting].filter(Boolean).map(server=>new Promise(resolve=>server.close(resolve))));automationStore.close();db.close();economy.db.close();const target=path.resolve(temp);assert.ok(target.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(target,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
