const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),express=require('express');
const {chromium}=require('playwright');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hv-diplomacy-browser-'));process.env.DB_PATH=path.join(temp,'website.sqlite');
process.env.GROUP_DIPLOMACY_ENABLED='1';process.env.GROUP_TREASURY_ENABLED='0';process.env.GROUP_TREASURY_SPEND_ENABLED='0';process.env.GROUP_HQ_ENABLED='0';
for(const name of ['GROUP_DIPLOMACY_READ_ONLY','SKIN_STUDIO_READ_ONLY','RENDER_SERVICE_ID','RENDER_EXTERNAL_URL','PUBLIC_SITE_URL','STEAM_REALM','STEAM_RETURN_URL'])delete process.env[name];
const {db}=require('../server/db'),groups=require('../server/groupsStore');
const service=require('../server/services/groupDiplomacy').createGroupDiplomacy(db,groups);
const provenance=require('../server/services/territoryBattleProvenance').createBattleProvenance(db),links=require('../server/services/groupTerritoryLinks').createGroupTerritoryLinks(db,groups);
db.exec('CREATE TABLE territory_groups(id INTEGER PRIMARY KEY,name TEXT,leader_user_id INTEGER)');
let dropWrite=false,holdPair=false,held=null,unknown=false,writeCalls=0;
const app=express();app.use(express.json());app.use((req,res,next)=>{const actor=String(req.headers.cookie||'').match(/fixture-account=(\d{17})/)?.[1];if(actor)req.user=db.prepare('SELECT * FROM users WHERE steam_id=?').get(actor);next();});
app.get('/api/me',(req,res)=>res.json({loggedIn:Boolean(req.user),user:req.user||null,steamLoginConfigured:true}));
app.use('/api/group-diplomacy',(req,res,next)=>{
 if(req.method==='POST')writeCalls++;
 if(req.method==='POST'&&dropWrite){dropWrite=false;res.json=()=>{res.status(200).type('application/json');res.write('{',()=>res.destroy());return res;};}
 if(req.method==='GET'&&req.path.startsWith('/relations/')){
  if(unknown){const json=res.json.bind(res);res.json=body=>json({...body,headToHead:{available:false,totals:null,battles:[]}});}
  if(holdPair){holdPair=false;const json=res.json.bind(res);res.json=body=>{held=()=>{held=null;json(body);};return res;};}
 }next();
});
app.use('/api/group-diplomacy',require('../server/routes/groupDiplomacy'));app.use('/api/groups',require('../server/routes/groups'));app.use('/api/group-headquarters',require('../server/routes/groupHeadquarters'));app.use('/api/group-treasury',require('../server/routes/groupTreasury'));
const unexpected=[];app.use('/api',(req,res)=>{unexpected.push(req.method+' '+req.path);res.status(404).json({error:'Unexpected fixture API'});});
app.get('/groups',(_req,res)=>res.sendFile(path.join(__dirname,'../public/groups.html')));app.use(express.static(path.join(__dirname,'../public')));
async function until(fn){for(let index=0;index<300;index++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Fixture observation timed out');}
(async()=>{
 let server,browser;
 try{
  server=await new Promise(resolve=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));});const base='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,executablePath:process.env.HV_TEST_BROWSER||undefined});let fixture=0;
  for(const width of [1440,390]){
   const n=++fixture,A=String(76561198000024000n+BigInt(n*10)),B=String(BigInt(A)+1n),M=String(BigInt(A)+2n);
   for(const actor of [A,B,M])db.prepare('INSERT INTO users(steam_id,username) VALUES(?,?)').run(actor,'Synthetic account');
   const ownName='Local Pack '+n+' <img src=x>',peerName='Valley Peers '+n+' <img src=x>',a=groups.createGroup(A,ownName).current.id,b=groups.createGroup(B,peerName).current.id;
   groups.invite(A,M);groups.actOnInvite(M,groups.getState(M).incoming[0].id,'accept');
   for(const [groupId,actor]of[[a,A],[b,B]]){const userId=db.prepare('SELECT id FROM users WHERE steam_id=?').get(actor).id;db.prepare('INSERT INTO territory_groups VALUES(?,?,?)').run(groupId,'Synthetic Territory '+groupId,userId);links.set(actor,{expectedGroupId:groupId,territoryGroupId:groupId,expectedRevision:0});}
   for(let index=1;index<=3;index++){const id=n*100+index,at=Date.now()-60000+index*100;provenance.begin(id,n,at,{attackerGroupId:a,defenderGroupId:b});provenance.observe(id,{usable:true},at+10);provenance.finish(id,at+20,index===2?'defence':'capture',{manual:index===3});}
   const context=await browser.newContext({viewport:{width,height:1000}});await context.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{document.body.dataset.suppressDailyClaim='true';}));await context.addCookies([{name:'fixture-account',value:A,url:base}]);await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
   const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
   const idle=()=>page.waitForFunction(()=>!document.getElementById('diplomacy-refresh').disabled);
   const findPeer=async name=>{await idle();await page.fill('#diplomacy-search',name);await page.click('#diplomacy-search-submit');await page.locator('#diplomacy-search-results button').first().waitFor();await idle();await page.locator('#diplomacy-search-results button').first().click();await page.locator('#diplomacy-detail').waitFor();await idle();};
   const review=async action=>{await idle();await page.selectOption('#diplomacy-action',action);await page.click('#diplomacy-review-button');await page.locator('#diplomacy-review').waitFor();};
   const confirm=async()=>{await page.click('#diplomacy-confirm');await idle();};
   await page.goto(base+'/groups');await page.locator('#group-diplomacy').waitFor();await idle();unknown=true;await findPeer('Valley Peers '+n);assert.equal(await page.locator('#diplomacy-score').textContent(),'Verified Territory history is unavailable.');unknown=false;
   await page.click('#diplomacy-refresh');await idle();assert.match(await page.locator('#diplomacy-score').textContent(),/1–1.*2 recorded battles/);assert.equal(await page.locator('#diplomacy-battles li').count(),2);
   await review('propose_alliance');assert.equal(service.detail(A,b).revision,0);assert.match(await page.locator('#diplomacy-review-text').textContent(),/Local Pack/);
   const beforeWrite=writeCalls;dropWrite=true;await confirm();await page.getByRole('button',{name:'Retry saved request',exact:true}).waitFor();assert.equal(writeCalls,beforeWrite+1);assert.equal(service.detail(A,b).revision,1);await confirm();assert.equal(service.detail(A,b).history.length,1);assert.equal(writeCalls,beforeWrite+2);assert.equal(await page.locator('#diplomacy-alliance').textContent(),'Alliance proposal sent');
   // Keep enough retained neutral pairs to exercise the real cursor control.
   for(let index=0;index<51;index++){const other=Number(db.prepare("INSERT INTO hv_groups(name,owner_steam_id,status) VALUES(?,?,'closed')").run('Historic peer '+n+' '+index,B).lastInsertRowid);db.prepare("INSERT INTO hv_group_relations(group_low,group_high,revision,alliance,low_rival,high_rival,updated_at) VALUES(?,?,1,'none',0,0,1)").run(Math.min(a,other),Math.max(a,other));}
   await page.click('#diplomacy-refresh');await idle();assert.equal(await page.locator('#diplomacy-relations li').count(),50);await page.click('#diplomacy-more');await idle();assert.equal(await page.locator('#diplomacy-relations li').count(),52);
   await context.addCookies([{name:'fixture-account',value:B,url:base}]);await page.reload();await page.locator('#diplomacy-relations button').first().waitFor();await idle();await page.locator('#diplomacy-relations button').first().click();await idle();assert.equal(await page.locator('#diplomacy-alliance').textContent(),'Alliance proposal received');await review('accept_alliance');await confirm();assert.equal(service.detail(A,b).effectiveAlliance,true);
   await context.addCookies([{name:'fixture-account',value:M,url:base}]);await page.reload();await page.locator('#diplomacy-relations button').first().waitFor();await idle();await page.locator('#diplomacy-relations button').first().click();await idle();assert.equal(await page.locator('#diplomacy-action-form').isVisible(),false);assert.equal(await page.locator('#diplomacy-alliance').textContent(),'Allied');
   await context.addCookies([{name:'fixture-account',value:A,url:base}]);await page.reload();await findPeer('Valley Peers '+n);await review('declare_rival');assert.match(await page.locator('#diplomacy-review-text').textContent(),/ends any alliance/);await confirm();assert.equal(service.detail(A,b).outgoingRival,true);
   await review('clear_rival');service.change(B,{expectedGroupId:b,targetGroupId:a,expectedRevision:3,action:'declare_rival',requestId:'concurrent_rival_'+n});await confirm();assert.match(await page.locator('#diplomacy-status').textContent(),/relationship changed/i);assert.equal(service.detail(A,b).outgoingRival,true);assert.equal(await page.locator('#diplomacy-review').isVisible(),false);
   await review('clear_rival');await confirm();assert.equal(service.detail(A,b).outgoingRival,false);assert.equal(service.detail(A,b).incomingRival,true);
   process.env.GROUP_DIPLOMACY_READ_ONLY='1';await page.click('#diplomacy-refresh');await idle();assert.equal(await page.locator('#diplomacy-review-button').isDisabled(),true);process.env.GROUP_DIPLOMACY_READ_ONLY='0';await page.click('#diplomacy-refresh');await idle();
   assert.equal(await page.locator('#group-diplomacy img').count(),0);assert.equal(await page.locator('#group-diplomacy').evaluate(el=>el.getBoundingClientRect().right<=innerWidth+1),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
   holdPair=true;await page.click('#diplomacy-refresh');await until(()=>held);page.once('dialog',dialog=>dialog.accept());await page.click('#groups-leave');await page.locator('#groups-create-panel').waitFor();assert.equal(await page.locator('#group-diplomacy').isVisible(),false);
   await page.fill('#groups-name','Replacement '+n);await page.click('#groups-create-form button');await page.locator('#group-diplomacy').waitFor();await idle();held();assert.equal(await page.locator('#diplomacy-detail').isVisible(),false);assert.equal(await page.locator('#diplomacy-relations li').textContent(),'No recorded relationships yet.');
   const stale=await context.request.post(base+'/api/group-diplomacy/relations/'+b,{headers:{Origin:base},data:{expectedGroupId:a,expectedRevision:5,action:'declare_rival',requestId:'stale_group_'+n}});assert.equal(stale.status(),409);
   await context.clearCookies();await page.click('#diplomacy-refresh');await page.waitForFunction(()=>document.getElementById('group-diplomacy').hidden);assert.equal(await page.locator('#diplomacy-history li').count(),0);
   process.env.GROUP_DIPLOMACY_ENABLED='0';await context.addCookies([{name:'fixture-account',value:M,url:base}]);await page.reload();await page.locator('#groups-current-panel').waitFor();assert.equal(await page.locator('#group-diplomacy').isVisible(),false);process.env.GROUP_DIPLOMACY_ENABLED='1';
   await page.reload();await page.locator('#diplomacy-relations button').first().waitFor();await idle();await page.locator('#diplomacy-relations button').first().click();await idle();assert.equal(await page.locator('#diplomacy-action-form').isVisible(),true);assert.match(await page.locator('#diplomacy-score').textContent(),/1–1.*2 recorded battles/);
   assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);await context.close();console.log(`PASS ${width}px real diplomacy: bilateral alliance, directional rivalry, review, lost reply retry, conflicts, private battle totals, pagination, member/preview/session and group transitions`);
  }
 }finally{if(held)held();if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));db.close();const target=path.resolve(temp);assert.ok(target.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(target,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
