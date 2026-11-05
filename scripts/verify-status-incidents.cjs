"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),express=require('express'),{DatabaseSync}=require('node:sqlite'),{randomUUID}=require('node:crypto'),{chromium}=require('playwright');
for(const key of ['STATUS_INCIDENTS_READ_ONLY','SKIN_STUDIO_READ_ONLY','RENDER_SERVICE_ID','RENDER_EXTERNAL_URL','PUBLIC_SITE_URL','STEAM_REALM','STEAM_RETURN_URL'])delete process.env[key];
process.env.STATUS_INCIDENTS_PUBLIC_ENABLED='1';
const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,steam_id TEXT,is_admin INTEGER);INSERT INTO users VALUES(1,'76561198000000001',1)");
const admin={id:1,steam_id:'76561198000000001'},guild='111122223333444455';let clock=Date.now()-3600000;
const store=require('../server/services/statusIncidentStore').createStatusIncidentStore(db,{now:()=>clock,guild:()=>guild});let latest;
for(let i=0;i<26;i++){
 if(i%8===0)clock+=61000;const id=randomUUID();
 const details={components:['website','map'],severity:'degraded',status:'monitoring',title:i===25?'Connection <check>':'Recorded interruption '+(i+1),summary:'Staff have checked the interruption and are monitoring recovery.',startedAt:clock-60000,endedAt:null,verifiedAt:clock-1000,evidenceUrls:[`https://discord.com/channels/${guild}/222233334444555566/333344445555666677`],evidenceNote:'PRIVATE SOURCE 76561198000000999 must never appear in public.'};
 const saved=store.change(admin,{id,action:'save',expectedRevision:0,requestKey:randomUUID(),reason:'Synthetic browser review',details});store.change(admin,{id,action:'publish',expectedRevision:1,requestKey:randomUUID(),reason:'Synthetic public review',reviewDigest:saved.current.reviewDigest});latest=id;
}
const app=express(),unexpected=[];let failHistory=false;
app.get('/healthz',(_req,res)=>res.json({ok:true}));app.get('/readyz',(_req,res)=>res.json({ok:true}));app.get('/api/me',(_req,res)=>res.json({loggedIn:false,user:null,steamLoginConfigured:false}));
app.get('/api/server-status',(_req,res)=>res.json({configured:true,online:true,stale:false,lastChecked:new Date().toISOString(),playerCount:2,maxPlayers:100}));
app.use('/api/status-incidents',(req,res,next)=>failHistory&&req.path==='/'?res.status(503).json({error:'Synthetic unavailable source'}):next());app.use('/api/status-incidents',require('../server/routes/statusIncidents').createRouters({db,now:()=>clock}).publicRouter);
app.use('/api',(req,res)=>{unexpected.push(req.method+' '+req.originalUrl);res.status(404).json({error:'Unexpected fixture route'});});
app.get('/status',(_req,res)=>res.sendFile(path.resolve(__dirname,'../public/status.html')));app.use(express.static(path.resolve(__dirname,'../public')));
(async()=>{
 const server=app.listen(0,'127.0.0.1');let browser;
 try{
  await new Promise(resolve=>server.once('listening',resolve));const url='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,executablePath:process.env.HV_TEST_BROWSER||undefined});
  for(const width of [1440,390]){
   if(!store.read(admin,latest).publication){const value=store.read(admin,latest);store.change(admin,{id:latest,action:'publish',expectedRevision:value.revision,requestKey:randomUUID(),reason:'Restore synthetic browser report',reviewDigest:value.reviewDigest});}
   const context=await browser.newContext({viewport:{width,height:980}}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(url+'/status');
   await page.waitForFunction(()=>document.querySelectorAll('.hv-status-incident').length===25);assert.match(await page.locator('#status-overall').textContent(),/Website ready.*Game server online/);
   assert.match(await page.locator('#status-incidents-list').textContent(),/Connection <check>/);assert.equal(await page.locator('#status-incidents-list check').count(),0);assert.doesNotMatch(await page.locator('body').textContent(),/PRIVATE SOURCE|76561198000000999|discord\.com\/channels/);
   await page.click('#status-incidents-more');await page.waitForFunction(()=>document.querySelectorAll('.hv-status-incident').length===26);assert.equal(await page.locator('#status-incidents-more').isHidden(),true);
   await page.locator('#status-incidents-heading').scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   const output=process.env.HV_TEST_ARTIFACT_DIR||path.join(os.tmpdir(),'hv-status-incidents-browser');fs.mkdirSync(output,{recursive:true});const screenshot=path.join(output,'incidents-'+width+'.png');await page.screenshot({path:screenshot});
   const value=store.read(admin,latest);store.change(admin,{id:latest,action:'withdraw',expectedRevision:value.revision,requestKey:randomUUID(),reason:'Synthetic privacy withdrawal'});
   await page.click('#status-refresh');await page.waitForFunction(()=>document.querySelectorAll('.hv-status-incident').length===25);assert.doesNotMatch(await page.locator('#status-incidents-list').textContent(),/Connection <check>/);
   failHistory=true;await page.click('#status-refresh');await page.waitForFunction(()=>document.getElementById('status-incidents-message').textContent.includes('could not be verified'));assert.equal(await page.locator('.hv-status-incident').count(),0);assert.match(await page.locator('#status-overall').textContent(),/Website ready.*Game server online/);failHistory=false;
   process.env.STATUS_INCIDENTS_PUBLIC_ENABLED='0';await page.click('#status-refresh');await page.waitForFunction(()=>document.getElementById('status-incidents-message').textContent.includes('not available yet'));process.env.STATUS_INCIDENTS_PUBLIC_ENABLED='1';
   assert.deepEqual(errors,[]);await context.close();console.log(JSON.stringify({width,statusIncidents:'passed',screenshot}));
  }
  assert.deepEqual(unexpected,[]);
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
