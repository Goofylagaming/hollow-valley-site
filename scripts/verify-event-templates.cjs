const assert=require('node:assert/strict'),path=require('node:path'),express=require('express');
const {DatabaseSync}=require('node:sqlite'),{chromium}=require('playwright');
for(const name of ['EVENT_ENGINE_READ_ONLY','SKIN_STUDIO_READ_ONLY','RENDER_SERVICE_ID','RENDER_EXTERNAL_URL','PUBLIC_SITE_URL','STEAM_REALM','STEAM_RETURN_URL'])delete process.env[name];process.env.EVENT_ENGINE_ENABLED='1';
const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,steam_id TEXT,username TEXT,is_admin INTEGER);INSERT INTO users VALUES(1,'76561198000000001','Staff fixture',1),(2,'76561198000000002','Other staff fixture',1),(3,'76561198000000003','Member fixture',0)");
const store=require('../server/services/eventTemplateStore').createEventTemplateStore(db),app=express();app.use(express.json());app.use((req,_res,next)=>{req.user=db.prepare('SELECT * FROM users WHERE id=?').get(Number(String(req.headers.cookie||'').match(/fixture-account=(\d+)/)?.[1]||0));next();});
app.get('/api/me',(req,res)=>res.json({loggedIn:Boolean(req.user),user:req.user||null,eventTemplateBuilderEnabled:process.env.EVENT_ENGINE_ENABLED==='1'&&Boolean(req.user?.is_admin),steamLoginConfigured:true}));
app.get('/api/events',(_req,res)=>res.json({configured:true,stale:false,events:[]}));app.get('/api/events/species-bonuses',(_req,res)=>res.json({enabled:false,events:[]}));
app.get(['/api/events/rewards/mine','/api/events/admin/rewards'],(_req,res)=>res.json({rewards:[],state:{enabled:false}}));
app.get(['/api/events/attendance/mine','/api/events/admin/attendance'],(_req,res)=>res.json({attendance:[],state:{enabled:false}}));
app.get('/api/events/admin/players',(_req,res)=>res.json({players:[]}));app.get('/api/events/admin/group-registrations/events',(_req,res)=>res.json({events:[],nextEventId:null}));
app.get('/api/admin/challenge-attendance/capabilities',(_req,res)=>res.json({enabled:false}));app.get('/api/server-status',(_req,res)=>res.json({configured:false}));app.post('/api/wallet/daily-login/claim',(_req,res)=>res.json({duplicate:true,amount:0}));
let writes=0,drop=false,hold=false,held=null;const unexpected=[];
app.use('/api/event-templates',(req,res,next)=>{if(req.method==='POST'){writes++;if(drop){drop=false;res.json=()=>{res.status(200).type('application/json');res.write('{',()=>res.destroy());return res;};}}if(req.method==='GET'&&req.path==='/'&&hold){hold=false;const json=res.json.bind(res);res.json=value=>{held=()=>{held=null;json(value);};return res;};}next();});
app.use('/api/event-templates',require('../server/routes/eventTemplates').createRouter({db}));
app.use('/api',(req,res)=>{unexpected.push(req.method+' '+req.path);res.status(404).json({error:'Unexpected fixture API'});});
app.get('/events',(_req,res)=>res.sendFile(path.join(__dirname,'../public/events.html')));app.use(express.static(path.join(__dirname,'../public')));
async function until(fn){for(let n=0;n<300;n++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Fixture observation timed out');}
(async()=>{let server,browser;try{
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const url='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,executablePath:process.env.HV_TEST_BROWSER||undefined});
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const cookie=id=>context.addCookies([{name:'fixture-account',value:String(id),url}]),idle=()=>page.waitForFunction(()=>document.getElementById('event-template-panel').getAttribute('aria-busy')==='false');
  await cookie(1);await page.goto(url+'/events');await page.locator('#event-template-panel').waitFor();await idle();
  const form=page.locator('#event-template-form');assert.equal(await form.locator('select option').count(),8);
  const title='Valley Migration '+width+' <img src=x>';
  await form.locator('[name=kind]').selectOption('migration');await form.locator('[name=title]').fill(title);await form.locator('[name=description]').fill('A staff-reviewed route through the Valley.');await form.locator('[name=rules]').fill('Follow staff directions at every route checkpoint.');
  const before=writes;await form.getByRole('button',{name:'Review template',exact:true}).click();assert.equal(writes,before);assert.match(await page.locator('#event-template-summary').textContent(),/staff-reviewed/);assert.equal(await page.locator('#event-template-summary img').count(),0);
  const confirm=async()=>{await page.click('#event-template-confirm');await idle();};drop=true;await confirm();await page.getByRole('button',{name:'Retry saved template request',exact:true}).waitFor();
  const saved=db.prepare('SELECT * FROM hv_event_templates WHERE json_extract(definition_json,\'$.title\')=?').get(title);assert.equal(saved.revision,1);await confirm();assert.equal(writes,before+2);assert.equal(store.read({id:1,steam_id:'76561198000000001'},saved.id).revision,1);
  assert.equal(await page.locator('#event-template-history li').count(),1);
  await form.locator('[name=title]').fill('My stale edit '+width);await form.getByRole('button',{name:'Review template',exact:true}).click();
  store.change({id:2,steam_id:'76561198000000002'},{id:saved.id,expectedRevision:1,requestKey:require('node:crypto').randomUUID(),action:'save',details:{...JSON.parse(saved.definition_json),title:'Other staff revision '+width}});
  await confirm();assert.match(await page.locator('#event-template-status').textContent(),/changed/);assert.equal(await page.locator('#event-template-review').isVisible(),false);
  await page.locator('#event-template-list button').filter({hasText:'Other staff revision '+width}).click();await idle();assert.equal(await form.locator('[name=title]').inputValue(),'Other staff revision '+width);assert.equal(await page.locator('#event-template-history li').count(),2);
  process.env.EVENT_ENGINE_READ_ONLY='1';await page.click('#event-template-refresh');await idle();assert.equal(await form.locator('[name=title]').isDisabled(),true);delete process.env.EVENT_ENGINE_READ_ONLY;
  await page.click('#event-template-refresh');await idle();await page.locator('#event-template-list button').filter({hasText:'Other staff revision '+width}).click();await idle();await page.click('#event-template-archive');await confirm();assert.equal(store.read({id:1,steam_id:'76561198000000001'},saved.id).state,'archived');assert.equal(await form.locator('[name=title]').isDisabled(),true);
  await page.check('#event-template-archived');await idle();assert.equal(await page.locator('#event-template-list button').filter({hasText:'Other staff revision '+width}).count(),1);
  await page.click('#event-template-new');await form.locator('[name=title]').fill('Private unsaved staff draft');hold=true;await page.click('#event-template-refresh');await until(()=>held);await cookie(2);held();await idle();assert.equal(await page.locator('#event-template-panel').isVisible(),false);assert.equal(await form.locator('[name=title]').inputValue(),'');assert.equal(await page.locator('#event-template-list li').count(),0);
  await cookie(3);await page.reload();await idle();assert.equal(await page.locator('#event-template-panel').isVisible(),false);
  await cookie(1);await page.reload();await page.locator('#event-template-panel').waitFor();await idle();
  hold=true;await page.click('#event-template-refresh');await until(()=>held);db.exec('UPDATE users SET is_admin=0 WHERE id=1');held();await idle();assert.equal(await page.locator('#event-template-panel').isVisible(),false);assert.equal(await page.locator('#event-template-list li').count(),0);db.exec('UPDATE users SET is_admin=1 WHERE id=1');
  await cookie(1);await page.reload();await page.locator('#event-template-panel').waitFor();await idle();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  process.env.EVENT_ENGINE_ENABLED='0';await page.click('#event-template-refresh');await idle();assert.equal(await page.locator('#event-template-panel').isVisible(),false);process.env.EVENT_ENGINE_ENABLED='1';
  assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);await context.close();console.log(`PASS ${width}px actual Events template builder: review, retry, conflict, history, archive, preview, safe text and current-account privacy`);
 }
}finally{if(held)held();if(browser)await browser.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}db.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
