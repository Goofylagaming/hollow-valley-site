const assert=require('node:assert/strict'),path=require('node:path'),express=require('express');
const {DatabaseSync}=require('node:sqlite'),{randomUUID,randomBytes}=require('node:crypto'),{chromium}=require('playwright');
for(const key of ['DYNAMIC_CHALLENGES_READ_ONLY','SKIN_STUDIO_READ_ONLY','RENDER_SERVICE_ID','RENDER_EXTERNAL_URL','PUBLIC_SITE_URL','STEAM_REALM','STEAM_RETURN_URL'])delete process.env[key];
Object.assign(process.env,{DYNAMIC_CHALLENGES_ENABLED:'1',DYNAMIC_CHALLENGES_EVENTS_ENABLED:'1',DYNAMIC_CHALLENGES_EVENT_GUILD_ID:'10000000000001',VALLEY_LEGACY_ENABLED:'1',AUTOMATION_ADMIN_TOKEN:randomBytes(32).toString('hex')});
const db=new DatabaseSync(':memory:'),web=new DatabaseSync(':memory:');let clock=Date.parse('2026-11-05T08:00:00+10:00');
const store=require('../automation-platform/src/services/valleyLegacyStore').createLegacyStore(db,{now:()=>clock});
const legacy=require('../automation-platform/src/services/valleyLegacyService'),oldGet=legacy.get;legacy.get=()=>store;
const STAFF='76561198000000801',OTHER='76561198000000802',PLAYER='76561198000000803',EVENT='10000000000002',GUILD=process.env.DYNAMIC_CHALLENGES_EVENT_GUILD_ID;
web.exec('CREATE TABLE users(id INTEGER PRIMARY KEY,steam_id TEXT,username TEXT,is_admin INTEGER)');
for(const[id,steam,admin]of [[1,STAFF,1],[2,OTHER,1],[3,PLAYER,0]])web.prepare('INSERT INTO users VALUES (?,?,?,?)').run(id,steam,'Synthetic account',admin);
store.challenges.change(PLAYER,{selected:true,expectedRevision:0,requestKey:randomUUID()});clock+=2*3600000;
db.exec('CREATE TABLE automation_state(key TEXT PRIMARY KEY,value_json TEXT)');
db.prepare('INSERT INTO automation_state VALUES (?,?)').run('discord:scheduled-events',JSON.stringify({guildId:GUILD,syncedAt:new Date(clock).toISOString(),events:[{id:EVENT,guildId:GUILD,title:'Valley event <img src=x>',status:'completed',startTime:'2026-11-04T22:30:00.000Z',endTime:'2026-11-04T23:30:00.000Z'}]}));
const backend=express();backend.use(express.json());backend.use('/api/admin/challenge-attendance',require('../automation-platform/src/routes/challengeAttendanceAdminRoutes'));
const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user=web.prepare('SELECT * FROM users WHERE steam_id=?').get(String(req.headers.cookie||'').match(/fixture-account=(\d{17})/)?.[1]||'');next();});
app.get('/api/me',(req,res)=>res.json({loggedIn:Boolean(req.user),user:req.user||null,steamLoginConfigured:true}));
app.get('/api/events',(_req,res)=>res.json({configured:true,stale:false,events:[]}));
app.get('/api/events/species-bonuses',(_req,res)=>res.json({enabled:false,events:[]}));
app.get(['/api/events/rewards/mine','/api/events/admin/rewards'],(_req,res)=>res.json({rewards:[],state:{enabled:false}}));
app.get(['/api/events/attendance/mine','/api/events/admin/attendance'],(_req,res)=>res.json({attendance:[],state:{enabled:false}}));
app.get('/api/events/admin/players',(_req,res)=>res.json({players:[]}));
app.get('/api/events/admin/group-registrations/events',(_req,res)=>res.json({events:[],nextEventId:null}));
app.get('/api/server-status',(_req,res)=>res.json({configured:false}));
app.post('/api/wallet/daily-login/claim',(_req,res)=>res.json({duplicate:true,amount:0}));
let drop=false,hold=false,held=null,confirmations=0;
app.use('/api/admin/challenge-attendance',(req,res,next)=>{
 if(req.path.endsWith('/confirm'))confirmations++;
 if(req.path.endsWith('/confirm')&&drop){drop=false;res.json=()=>{res.status(200).type('application/json');res.write('{',()=>res.destroy());return res;};}
 if(req.path==='/reviews'&&req.method==='POST'&&hold){hold=false;const json=res.json.bind(res);res.json=body=>{held=()=>{held=null;json(body);};return res;};}
 next();
});
app.use('/api/admin/challenge-attendance',require('../server/routes/challengeAttendance').createRouter({db:web,now:()=>clock}));
const unexpected=[];app.use('/api',(req,res)=>{unexpected.push(req.method+' '+req.path);res.status(404).json({error:'Unexpected fixture API'});});
app.get('/events',(_req,res)=>res.sendFile(path.join(__dirname,'../public/events.html')));app.use(express.static(path.join(__dirname,'../public')));
const listen=app=>new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve({server,url:`http://127.0.0.1:${server.address().port}`}));});
async function until(fn){for(let n=0;n<300;n++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Fixture wait timed out');}
(async()=>{
 let internal,website,browser;
 try{
  internal=await listen(backend);process.env.AUTOMATION_SERVICE_URL=internal.url;website=await listen(app);browser=await chromium.launch({headless:true,executablePath:process.env.HV_TEST_BROWSER||undefined});
  for(const width of [1440,390]){
   const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   const cookie=who=>context.addCookies([{name:'fixture-account',value:who,url:website.url}]);const idle=()=>page.waitForFunction(()=>!document.getElementById('attendance-evidence-refresh').disabled);
   await cookie(STAFF);await page.goto(website.url+'/events');await page.locator('#attendance-evidence-panel').waitFor();await idle();
   const fill=async action=>{await page.fill('#attendance-evidence-event',EVENT);await page.fill('#attendance-evidence-player',PLAYER);await page.selectOption('#attendance-evidence-action',action);await page.fill('#attendance-evidence-time','2026-11-05T09:00');await page.fill('#attendance-evidence-proof',`https://discord.com/channels/${GUILD}/10000000000003/10000000000004`);await page.fill('#attendance-evidence-reason','Observed actual attendance <img src=x>');};
   const review=async action=>{await fill(action);await page.locator('#attendance-evidence-form button').click();await page.locator('#attendance-evidence-review').waitFor();await idle();};
   const before=db.prepare('SELECT count(*) n FROM dc_attendance_audit').get().n;
   await review('confirm');assert.equal(db.prepare('SELECT count(*) n FROM dc_attendance_audit').get().n,before);assert.match(await page.locator('#attendance-evidence-summary').textContent(),/Valley event <img src=x>/);assert.equal(await page.locator('#attendance-evidence-summary img').count(),0);
   const posts=confirmations;drop=true;await page.click('#attendance-evidence-confirm');await idle();await page.getByRole('button',{name:'Retry saved confirmation',exact:true}).waitFor();assert.equal(confirmations,posts+1);
   await page.reload();await page.locator('#attendance-evidence-panel').waitFor();await idle();await page.getByRole('button',{name:'Retry saved confirmation',exact:true}).waitFor();assert.equal(confirmations,posts+1);
   const recoveryUrl=page.url();await page.click('#attendance-evidence-cancel');assert.match(await page.locator('#attendance-evidence-status').textContent(),/may have completed/);
   await page.goto(recoveryUrl);await page.locator('#attendance-evidence-panel').waitFor();await idle();await page.getByRole('button',{name:'Retry saved confirmation',exact:true}).waitFor();assert.equal(confirmations,posts+1);
   await page.click('#attendance-evidence-confirm');await idle();assert.equal(confirmations,posts+2);assert.equal(db.prepare('SELECT count(*) n FROM dc_attendance_audit').get().n,before+1);
   assert.match(await page.locator('#attendance-evidence-status').textContent(),/confirmed/);assert.equal(store.challenges.status(PLAYER).challenges.find(c=>c.id==='event-confirmed').progress,1);
   await review('revoke');await page.click('#attendance-evidence-confirm');await idle();assert.match(await page.locator('#attendance-evidence-status').textContent(),/revoked/);assert.equal(store.challenges.status(PLAYER).challenges.find(c=>c.id==='event-confirmed').progress,0);
   await review('confirm');const current=store.challenges.attendance.current(EVENT,PLAYER);
   store.challenges.attendance.change({eventId:EVENT,steamId:PLAYER,actorSteamId:OTHER,action:'confirm',expectedRevision:current.revision,eventRevision:current.event.revision,occurredAt:Date.parse('2026-11-04T23:00:00.000Z'),evidenceUrl:`https://discord.com/channels/${GUILD}/10000000000003/10000000000004`,reason:'Other staff reviewed the evidence',requestKey:randomUUID()});
   await page.click('#attendance-evidence-confirm');await idle();assert.equal(await page.locator('#attendance-evidence-review').isVisible(),false);assert.match(await page.locator('#attendance-evidence-status').textContent(),/changed/);
   process.env.DYNAMIC_CHALLENGES_READ_ONLY='1';await page.click('#attendance-evidence-refresh');await idle();assert.equal(await page.locator('#attendance-evidence-event').isDisabled(),true);delete process.env.DYNAMIC_CHALLENGES_READ_ONLY;
   await page.click('#attendance-evidence-refresh');await idle();await fill('revoke');hold=true;await page.locator('#attendance-evidence-form button').click();await until(()=>held);await cookie(OTHER);held();await idle();assert.equal(await page.locator('#attendance-evidence-review').isVisible(),false);assert.equal(await page.locator('#attendance-evidence-summary p').count(),0);
   assert.equal(await page.locator('#attendance-evidence-proof').inputValue(),'');assert.equal(await page.locator('#attendance-evidence-player').inputValue(),'');assert.equal(await page.locator('#attendance-evidence-reason').inputValue(),'');
   await page.goto(recoveryUrl);await page.locator('#attendance-evidence-panel').waitFor();await idle();assert.equal(await page.locator('#attendance-evidence-summary p').count(),0);assert.match(await page.locator('#attendance-evidence-status').textContent(),/unavailable to this account/);
   await context.clearCookies();await page.click('#attendance-evidence-refresh');await idle();assert.equal(await page.locator('#attendance-evidence-panel').isVisible(),false);
   await cookie(PLAYER);await page.reload();await idle();assert.equal(await page.locator('#attendance-evidence-panel').isVisible(),false);
   await cookie(STAFF);await page.reload();await page.locator('#attendance-evidence-panel').waitFor();await idle();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
   process.env.DYNAMIC_CHALLENGES_EVENTS_ENABLED='0';await page.click('#attendance-evidence-refresh');await idle();assert.equal(await page.locator('#attendance-evidence-panel').isVisible(),false);process.env.DYNAMIC_CHALLENGES_EVENTS_ENABLED='1';
   assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);await context.close();console.log(`PASS ${width}px actual Events staff attendance: fixed reviews, explicit confirm/retry, revocation, conflict, preview, account changes, safe text and member privacy`);
  }
 }finally{if(held)held();if(browser)await browser.close();for(const s of [website,internal])if(s)await new Promise(resolve=>s.server.close(resolve));legacy.get=oldGet;db.close();web.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
