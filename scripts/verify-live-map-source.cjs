'use strict';
const assert=require('node:assert/strict'),express=require('express'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{chromium}=require('playwright');
const {positions}=require('../server/services/liveMapProjection');
const user={id:1,steam_id:'fixture-owner',username:'Map tester',is_admin:false};
let mode='fresh';const app=express(),unexpected=[];
app.get('/api/me',(_req,res)=>res.json({loggedIn:true,user,steamLoginConfigured:true}));
app.post('/api/wallet/daily-login/claim',(_req,res)=>res.json({duplicate:true,amount:0}));
app.get('/api/map/positions',(_req,res)=>{
 if(mode==='failure')return res.status(503).json({error:'Synthetic source unavailable'});
 if(mode==='signed-out')return res.status(401).json({error:'Not logged in'});
 const now=Date.now(),state={configured:true,online:mode!=='offline',lastChecked:new Date(now).toISOString(),characters:[{steamId:user.steam_id,name:'Private owner <test>',species:'Rex',health:.8,growth:.5,location:mode==='outside'?{x:1e9,y:0}:{x:123000,y:234000}},{steamId:'fixture-other',name:'Other survivor',species:'Trike',location:{x:12000,y:34000}}],playerCount:2,maxPlayers:100};
 const body=positions(state,user,now);
 // Simulate a cached HTTP response whose original timestamp has expired.
 if(mode==='cached')body.lastChecked=new Date(now-120001).toISOString();
 if(mode==='future')body.lastChecked=new Date(now+60000).toISOString();
 res.json(body);
});
app.get('/api/discovery/capabilities',(_req,res)=>res.json({enabled:false}));
app.get('/api/mapdata',(_req,res)=>res.json({mapVersion:'synthetic',layers:{saltLicks:[],roads:[],wildlife:[],migrations:[],patrolZones:[],sanctuaries:[]}}));
app.get('/api/map/activity',(_req,res)=>res.json({trackingEnabled:false,topSpecies:[],activityTrend:[]}));
app.get('/api/mydinos/prime-tracker',(_req,res)=>res.json({enabled:false}));
app.get('/api/live-map/territory-overlay/overlay-state',(_req,res)=>res.status(401).json({error:'Fixture overlay unavailable'}));
app.use('/api',(req,res)=>{unexpected.push(req.method+' '+req.path);res.status(404).json({error:'Unexpected fixture API'});});
app.use(express.static(path.resolve(__dirname,'../public')));
(async()=>{
 const server=app.listen(0,'127.0.0.1');let browser;
 try{
  await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,executablePath:process.env.HV_TEST_BROWSER||undefined});
  for(const width of [1440,390]){
   mode='fresh';const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/livemap.html');
   await page.waitForFunction(()=>window.HVLiveMapState?.connected===true);await page.locator('#tracker-markers .marker.me').waitFor();assert.match(await page.locator('#tracker-character').textContent(),/Private owner <test>/);assert.equal(await page.locator('#tracker-character test').count(),0);assert.equal(await page.locator('#tracker-markers .marker.other').count(),0);
   async function refresh(next){mode=next;await page.evaluate(()=>loadMap());}
   for(const next of ['cached','future','failure','signed-out','offline']){
    await refresh('fresh');assert.equal(await page.locator('#tracker-markers .marker.me').count(),1);
    await refresh(next);assert.equal(await page.evaluate(()=>window.HVLiveMapState?.connected===true),false);assert.equal(await page.locator('#tracker-markers .marker').count(),0);assert.doesNotMatch(await page.locator('#tracker-character').textContent(),/Private owner|Lat 234|80%/);
    assert.doesNotMatch(await page.locator('#tracker-contacts').textContent(),/Other survivor/);await page.locator('#map-nav-me').click();assert.match(await page.locator('#map-nav-status').textContent(),/not available right now/);
   }
   await refresh('outside');assert.equal(await page.locator('#tracker-markers .marker.me').count(),0);assert.match(await page.locator('#tracker-character').textContent(),/Private owner/);
   await refresh('fresh');const output=process.env.HV_TEST_ARTIFACT_DIR||path.join(os.tmpdir(),'hv-live-map-source-browser');fs.mkdirSync(output,{recursive:true});await page.locator('#tracker-character').screenshot({path:path.join(output,'character-'+width+'.png')});
   assert.deepEqual(errors,[]);await context.close();console.log(JSON.stringify({width,liveMapSource:'passed'}));
  }
  assert.deepEqual(unexpected,[]);
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
