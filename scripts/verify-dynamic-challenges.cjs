const assert=require('node:assert/strict'),path=require('node:path'),express=require('express');
const {DatabaseSync}=require('node:sqlite'),{randomBytes,randomUUID}=require('node:crypto');
const {chromium}=require('playwright');
for(const name of ['DYNAMIC_CHALLENGES_READ_ONLY','SKIN_STUDIO_READ_ONLY','RENDER_SERVICE_ID','RENDER_EXTERNAL_URL','PUBLIC_SITE_URL','STEAM_REALM','STEAM_RETURN_URL'])delete process.env[name];
process.env.DYNAMIC_CHALLENGES_ENABLED='1';process.env.VALLEY_LEGACY_ENABLED='1';process.env.HOLLOW_VALLEY_API_TOKEN=randomBytes(32).toString('hex');
process.env.DYNAMIC_CHALLENGES_EVENTS_ENABLED='1';process.env.DYNAMIC_CHALLENGES_EVENT_GUILD_ID='10000000000001';
const db=new DatabaseSync(':memory:');let clock=Date.parse('2026-11-05T10:00:00+10:00');
const store=require('../automation-platform/src/services/valleyLegacyStore').createLegacyStore(db,{now:()=>clock});
const legacy=require('../automation-platform/src/services/valleyLegacyService'),oldGet=legacy.get;legacy.get=()=>store;
let drop=false,hold=false,held=null,writes=0;const unexpected=[];
const backend=express();backend.use(express.json());backend.use('/api/website/legacy',require('../automation-platform/src/routes/valleyLegacyRoutes'));
const app=express();app.use(express.json());app.use((req,_res,next)=>{const id=String(req.headers.cookie||'').match(/fixture-account=(\d{17})/)?.[1];if(id)req.user={steam_id:id,username:'Synthetic account'};next();});
app.get('/api/me',(req,res)=>res.json({loggedIn:Boolean(req.user),user:req.user||null,steamLoginConfigured:true}));
app.get('/api/quests',(_req,res)=>res.json({trackingEnabled:true,activeBoostPercent:5,quests:[{id:'daily-consecutive-1h',cadence:'daily',thresholdSeconds:3600,progressSeconds:600,completed:false}],challenges:[]}));
app.get('/api/server-status',(_req,res)=>res.json({configured:false}));
app.post('/api/wallet/daily-login/claim',(_req,res)=>res.json({duplicate:true,amount:0}));
app.use('/api/dynamic-challenges',(req,res,next)=>{
  if(req.method==='POST')writes++;
  if(req.method==='POST'&&drop){drop=false;res.json=()=>{res.status(200).type('application/json');res.write('{',()=>res.destroy());return res;};}
  if(req.method==='GET'&&req.path==='/me'&&hold){hold=false;const json=res.json.bind(res);res.json=body=>{held=()=>{held=null;json(body);};return res;};}
  next();
});
app.use('/api/dynamic-challenges',require('../server/routes/dynamicChallenges'));
app.use('/api',(req,res)=>{unexpected.push(req.method+' '+req.path);res.status(404).json({error:'Unexpected fixture API'});});
app.get('/quests',(_req,res)=>res.sendFile(path.join(__dirname,'../public/quests.html')));app.use(express.static(path.join(__dirname,'../public')));
const listen=app=>new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve({server,url:`http://127.0.0.1:${server.address().port}`}));});
async function until(fn){for(let n=0;n<300;n++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Fixture observation timed out');}
(async()=>{
 let internal,website,browser;
 try {
  internal=await listen(backend);process.env.AUTOMATION_SERVICE_URL=internal.url;website=await listen(app);
  browser=await chromium.launch({headless:true,executablePath:process.env.HV_TEST_BROWSER||undefined});
  for(const width of [1440,390]){
    const A=String(76561198000026000n+BigInt(width)),B=String(BigInt(A)+1n);
    const context=await browser.newContext({viewport:{width,height:980}});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    const cookie=id=>context.addCookies([{name:'fixture-account',value:id,url:website.url}]);
    const idle=()=>page.waitForFunction(()=>!document.getElementById('dynamic-refresh').disabled);
    const review=async()=>{await idle();await page.click('#dynamic-choice');await page.locator('#dynamic-review').waitFor();};
    const confirm=async()=>{await page.click('#dynamic-confirm');await idle();};
    await cookie(A);await page.goto(website.url+'/quests');await page.locator('#dynamic-details').waitFor();await idle();
    assert.equal(await page.locator('#quest-active-boost').textContent(),'+5%');assert.equal(await page.locator('[data-quest-id="daily-consecutive-1h"]').count(),1);
    const before=writes;await review();assert.equal(writes,before);assert.match(await page.locator('#dynamic-review-text').textContent(),/No coin rewards/);
    drop=true;await confirm();await page.getByRole('button',{name:'Retry saved request',exact:true}).waitFor();
    assert.equal(writes,before+1);assert.equal(store.challenges.status(A).revision,1);await confirm();
    assert.equal(writes,before+2);assert.equal(store.challenges.status(A).revision,1);assert.equal(store.challenges.status(A).participating,true);
    // Synthetic host-internal confirmation checks the player read/render path;
    // this does not stand in for the still-pending staff authorization screens.
    const eventId=String(1000000000010n+BigInt(width)),guildId=process.env.DYNAMIC_CHALLENGES_EVENT_GUILD_ID;
    const eventStart=clock+60000,eventEnd=clock+120000;clock+=180000;
    db.exec('CREATE TABLE IF NOT EXISTS automation_state(key TEXT PRIMARY KEY,value_json TEXT)');
    db.prepare("INSERT INTO automation_state VALUES ('discord:scheduled-events',?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json").run(JSON.stringify({guildId,syncedAt:new Date(clock).toISOString(),events:[{id:eventId,guildId,title:'Synthetic completed event',status:'completed',startTime:new Date(eventStart).toISOString(),endTime:new Date(eventEnd).toISOString()}]}));
    const attendance={eventId,steamId:A,actorSteamId:B,action:'confirm',expectedRevision:0,eventRevision:store.challenges.attendance.preview(eventId).revision,occurredAt:eventStart+30000,evidenceUrl:`https://discord.com/channels/${guildId}/10000000000003/10000000000004`,reason:'Synthetic host attendance evidence',requestKey:randomUUID()};
    store.challenges.attendance.change(attendance);await page.click('#dynamic-refresh');await idle();assert.match(await page.locator('#dynamic-list').textContent(),/1 \/ 1 event attendance confirmed by staff/);
    store.challenges.attendance.change({...attendance,action:'revoke',expectedRevision:1,requestKey:randomUUID()});await page.click('#dynamic-refresh');await idle();assert.match(await page.locator('#dynamic-list').textContent(),/0 \/ 1 event attendance confirmed by staff/);
    clock+=60000;store.snapshot([{steamId:A,species:'tyrannosaurus',growth:0.5}],clock);
    await page.click('#dynamic-refresh');await idle();assert.match(await page.locator('#dynamic-list').textContent(),/1 \/ 3 species observed/);
    const first=clock;for(let n=0;n<9;n++){clock+=600000;store.snapshot([{steamId:A,species:'tyrannosaurus',growth:0.5}],clock);}
    await page.click('#dynamic-refresh');await idle();assert.match(await page.locator('#dynamic-list').textContent(),/90 \/ 90 observed minutes/);
    store.ingest({id:'browser-late-death-'+width,type:'combat_death',steamId:A,at:first+45*60000});
    await page.click('#dynamic-refresh');await idle();assert.match(await page.locator('#dynamic-list').textContent(),/40 \/ 90 observed minutes/);
    await review();assert.match(await page.locator('#dynamic-review-text').textContent(),/delete its saved gameplay progress/);
    store.challenges.change(A,{selected:false,expectedRevision:1,requestKey:randomUUID()});
    await confirm();assert.equal(await page.locator('#dynamic-review').isVisible(),false);assert.match(await page.locator('#dynamic-status').textContent(),/changed/);
    assert.equal(store.challenges.status(A).revision,2);assert.match(await page.locator('#dynamic-participation').textContent(),/not participating/);
    process.env.DYNAMIC_CHALLENGES_READ_ONLY='1';await page.click('#dynamic-refresh');await idle();assert.equal(await page.locator('#dynamic-choice').isDisabled(),true);assert.match(await page.locator('#dynamic-preview').textContent(),/read-only/);delete process.env.DYNAMIC_CHALLENGES_READ_ONLY;
    await page.click('#dynamic-refresh');await idle();await review();await confirm();assert.equal(store.challenges.status(A).participating,true);
    hold=true;await page.click('#dynamic-refresh');await until(()=>held);await cookie(B);held();await idle();
    assert.equal(await page.locator('#dynamic-details').isVisible(),false);assert.equal(await page.locator('#dynamic-list article').count(),0);
    await page.click('#dynamic-refresh');await idle();assert.match(await page.locator('#dynamic-list').textContent(),/0 \/ 3 species observed/);
    await review();await context.clearCookies();await page.click('#dynamic-refresh');await idle();assert.equal(await page.locator('#dynamic-review').isVisible(),false);assert.equal(await page.locator('#dynamic-list article').count(),0);assert.match(await page.locator('#dynamic-status').textContent(),/Sign in/);
    await cookie(B);await page.click('#dynamic-refresh');await idle();await review();await confirm();assert.equal(store.challenges.status(B).participating,true);
    await review();await confirm();assert.equal(store.challenges.status(B).participating,false);assert.equal(store.challenges.status(B).challenges[1].progress,0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    process.env.DYNAMIC_CHALLENGES_ENABLED='0';await page.click('#dynamic-refresh');await idle();assert.equal(await page.locator('#dynamic-challenges').isVisible(),false);process.env.DYNAMIC_CHALLENGES_ENABLED='1';
    assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);await context.close();console.log(`PASS ${width}px real Quests: original board, explicit consent, lost reply/retry, evidence progress, stale revision, preview, delayed read/account switch, session loss and opt-out`);
  }
 }finally{
  if(held)held();if(browser)await browser.close();for(const s of [website,internal])if(s)await new Promise(resolve=>s.server.close(resolve));legacy.get=oldGet;db.close();
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
