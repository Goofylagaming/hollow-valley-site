const assert=require('node:assert/strict'),path=require('node:path'),express=require('express'),{chromium}=require('playwright');
const app=express();let mode='stale';const mutations=[],unexpected=[];
app.use(express.json());app.use((req,_res,next)=>{if(req.method!=='GET'&&req.path!=='/api/wallet/daily-login/claim')mutations.push(req.method+' '+req.path);next();});
app.get('/api/me',(_req,res)=>res.json({loggedIn:true,user:{id:1,steam_id:'76561198000000001',username:'Synthetic admin',is_admin:1},steamLoginConfigured:true}));
app.get('/api/server-status',(_req,res)=>res.json({configured:true,online:mode==='live',stale:mode==='stale',playerCount:0,maxPlayers:100}));
app.post('/api/wallet/daily-login/claim',(_req,res)=>res.json({duplicate:true,amount:0}));
const state=()=>({event:null,attack:null,log:[],leaderboard:[],registrations:[],liveTestGroups:[],availableGroups:[],presence:{tracking:true,stale:mode==='stale',serverOnline:mode==='live',region:'Synthetic battlefield',playerCount:mode==='live'?2:0,claimCount:mode==='live'?2:0,eligibleClaimCount:mode==='live'?2:0,players:[]}});
app.get(['/api/territory-wars/state','/api/territory-wars/admin/state'],(_req,res)=>res.json(state()));
app.get('/api/territory-wars/me',(_req,res)=>res.json({group:null,invites:[],members:[]}));
app.get('/api/territory-wars/admin/victory-delivery',(_req,res)=>res.json({deliveries:[]}));
app.use('/api',(req,res)=>{unexpected.push(req.method+' '+req.path);res.status(404).json({error:'Unexpected fixture API'});});
app.get('/territory',(_req,res)=>res.sendFile(path.join(__dirname,'../public/groups/territory-wars/index.html')));
app.get('/territory-admin',(_req,res)=>res.sendFile(path.join(__dirname,'../public/adminterritorywars.html')));
app.use(express.static(path.join(__dirname,'../public')));
(async()=>{
 let server,browser;
 try{
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const base='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,executablePath:process.env.HV_TEST_BROWSER||undefined});
  for(const width of [1440,390]){
   const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   for(const admin of [false,true]){
    mode='stale';await page.goto(base+(admin?'/territory-admin':'/territory'));
    const label=page.locator(admin?'#tw-admin-presence-count':'#tw-presence');
    await label.getByText(admin?'Tracking unavailable':'Live tracking unavailable · battle progress paused',{exact:true}).waitFor();
    mode='offline';await page.evaluate(flag=>flag?refreshPresence():loadPublicState(),admin);assert.equal(await label.textContent(),'Server offline');
    mode='live';await page.evaluate(flag=>flag?refreshPresence():loadPublicState(),admin);assert.match(await label.textContent(),/2/);
    mode='stale';await page.evaluate(flag=>flag?refreshPresence():loadPublicState(),admin);assert.match(await label.textContent(),/unavailable/);
    if(admin)assert.match(await page.locator('#tw-admin-presence').textContent(),/Battle progress is paused/);
   }
   assert.deepEqual(errors,[]);await context.close();console.log(`PASS ${width}px real Territory public/admin pages: stale tracking, verified offline, live counts and recovery without battle writes`);
  }
  assert.deepEqual(mutations,[]);assert.deepEqual(unexpected,[]);
 }finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
