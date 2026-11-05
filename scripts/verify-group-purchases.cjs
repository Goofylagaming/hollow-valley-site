const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),express=require('express');
const {chromium}=require('playwright');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hv-purchase-browser-'));
process.env.DB_PATH=path.join(temp,'website.sqlite');process.env.AUTOMATION_DB_PATH=path.join(temp,'economy.sqlite');
process.env.GROUP_TREASURY_TERRITORY_ENABLED='1';process.env.TERRITORY_WARS_ADMIN_TEST_ENABLED='1';process.env.GROUP_TREASURY_TERRITORY_PROOF_SECRET='synthetic-browser-entry-proof-key-0000000';
process.env.GROUP_TREASURY_ENABLED='1';process.env.GROUP_TREASURY_SPEND_ENABLED='1';process.env.GROUP_HQ_ENABLED='0';process.env.HOLLOW_VALLEY_API_TOKEN='synthetic-purchase-browser-token';
for(const key of ['GROUP_TREASURY_READ_ONLY','SKIN_STUDIO_READ_ONLY','RENDER_SERVICE_ID','RENDER_EXTERNAL_URL','PUBLIC_SITE_URL','STEAM_REALM','STEAM_RETURN_URL'])delete process.env[key];
const {db}=require('../server/db'),groups=require('../server/groupsStore'),economy=require('../automation-platform/src/services/economyStore');
const spending=require('../automation-platform/src/services/groupTreasurySpending').createGroupTreasurySpending(economy);
db.exec(fs.readFileSync(path.join(__dirname,'../server/routes/territoryWars.js'),'utf8').match(/db\.exec\(`([\s\S]*?)`\);/)[1]);db.exec('ALTER TABLE territory_events ADD COLUMN live_test_mode INTEGER NOT NULL DEFAULT 0');
const links=require('../server/services/groupTerritoryLinks').createGroupTerritoryLinks(db,groups);
let dropDispatch=false,holdDispatch=false,heldDispatch=null;
let dropReserve=false,dropCommit=false,holdReserve=false,heldReserve=null,failCatalog=false;
const calls={reserve:0,commit:0};
const auto=express();auto.use(express.json());auto.use('/api/website/group-treasury',(req,res,next)=>{
  const action=req.path.slice(1).replace('spend-','');if(action in calls)calls[action]++;
  if(req.path==='/spending-read'&&failCatalog)return res.status(503).json({error:'Synthetic cosmetic outage'});
  if(action==='dispatch-territory'&&holdDispatch){holdDispatch=false;heldDispatch=()=>next();return;}
  if(action==='dispatch-territory'&&dropDispatch){dropDispatch=false;res.json=()=>{res.destroy();return res;};}
  if(action==='reserve'&&holdReserve){holdReserve=false;heldReserve=()=>next();return;}
  if((action==='reserve'&&dropReserve)||(action==='commit'&&dropCommit)){dropReserve=false;dropCommit=false;res.json=()=>{res.destroy();return res;};}
  next();
});auto.use('/api/website/group-treasury',require('../automation-platform/src/routes/websiteGroupTreasuryRoutes'));
const app=express();app.use(express.json());app.use((req,_res,next)=>{const steam=String(req.headers.cookie||'').match(/(?:^|;\s*)fixture-account=(\d{17})(?:;|$)/)?.[1];if(steam)req.user=db.prepare('SELECT * FROM users WHERE steam_id=?').get(steam);next();});
app.get('/api/me',(req,res)=>res.json({loggedIn:Boolean(req.user),user:req.user||null,steamLoginConfigured:true}));
app.use('/api/groups',require('../server/routes/groups'));app.use('/api/group-treasury',require('../server/routes/groupTreasury'));app.use('/api/group-headquarters',require('../server/routes/groupHeadquarters'));
const unexpected=[];app.use('/api',(req,res)=>{unexpected.push(req.method+' '+req.path);res.status(404).json({error:'Unexpected fixture API'});});
app.get('/groups',(_req,res)=>res.sendFile(path.join(__dirname,'../public/groups.html')));app.use(express.static(path.join(__dirname,'../public')));
const listen=app=>new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
async function until(fn){for(let i=0;i<300;i++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Fixture observation timed out');}
(async()=>{
  let website,accounting,browser;
  try{
    accounting=await listen(auto);process.env.AUTOMATION_SERVICE_URL='http://127.0.0.1:'+accounting.address().port;
    website=await listen(app);const base='http://127.0.0.1:'+website.address().port;
    browser=await chromium.launch({headless:true,executablePath:process.env.HV_TEST_BROWSER});let n=0;
    for(const width of [1440,390]){
      n++;process.env.GROUP_TREASURY_SPEND_ENABLED='1';const A=String(76561198000003000n+BigInt(n*10+1)),B=String(76561198000003000n+BigInt(n*10+2));
      for(const [steam,name]of[[A,'Original owner'],[B,'Successor']]){db.prepare('INSERT INTO users(steam_id,username) VALUES(?,?)').run(steam,name);economy.applyWalletTransaction({steamId:steam,amount:1000,kind:'fixture',reason:'Synthetic browser balance',idempotencyKey:'fund:'+steam});}
      const groupId=groups.createGroup(A,'Shop '+n+' <img src=x>').current.id;groups.invite(A,B);groups.actOnInvite(B,groups.getState(B).incoming[0].id,'accept');
      const post=async(url,body)=>{const response=await fetch(base+'/api/group-treasury'+url,{method:'POST',headers:{Cookie:'fixture-account='+A,Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,200);return response.json();};
      const donation=await post('/donations',{expectedGroupId:groupId,amount:200,requestId:'fund_group_'+n});await post('/donations/'+donation.id+'/confirm',{expectedGroupId:groupId,confirmed:true});
      for(const [id,title,frame,cost]of[['browser-fern','Fern <img src=x>','fern',80],['browser-night','Night frame','night',50]]){
        spending.register({id,revision:1,title,description:'Synthetic test item only',cost,purpose:'group_cosmetic',target:{kind:'profile_frame',value:frame}},A);spending.setEnabled(id,1,true,A);
      }
      const userId=db.prepare('SELECT id FROM users WHERE steam_id=?').get(A).id;
      const territoryGroupId=Number(db.prepare('INSERT INTO territory_groups(name,leader_user_id) VALUES(?,?)').run('Linked Territory '+n,userId).lastInsertRowid);
      db.prepare("INSERT INTO territory_group_members(group_id,user_id,role) VALUES(?,?,'leader')").run(territoryGroupId,userId);links.set(A,{expectedGroupId:groupId,expectedRevision:0,territoryGroupId});
      const eventId=Number(db.prepare('INSERT INTO territory_events(name) VALUES(?)').run('Browser Entry '+n).lastInsertRowid);
      const secondEventId=Number(db.prepare('INSERT INTO territory_events(name) VALUES(?)').run('Cancelled Entry '+n).lastInsertRowid);
      for(const [id,event,cost]of[['browser-entry-'+n,eventId,20],['browser-cancel-entry-'+n,secondEventId,10]]){spending.register({id,revision:1,title:id,description:'Synthetic entry',cost,purpose:'territory_entry',target:{eventId:event}},A);spending.setEnabled(id,1,true,A);}
      const context=await browser.newContext({viewport:{width,height:1000}});
      await context.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{document.body.dataset.suppressDailyClaim='true';}));
      await context.addCookies([{name:'fixture-account',value:A,url:base}]);await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
      const page=await context.newPage(),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
      const idle=()=>page.waitForFunction(()=>!document.getElementById('treasury-shop-refresh').disabled);
      const balance=value=>page.waitForFunction(text=>document.getElementById('treasury-balance').textContent===text,`${value} Valley Coins`);
      const prepare=async item=>{await idle();await page.selectOption('#treasury-shop-item',item+':1');await page.click('#treasury-shop-review');await page.locator('#treasury-purchase-consent').waitFor();await idle();};
      const confirm=async label=>{await page.check('#treasury-purchase-consent');await page.getByRole('button',{name:label,exact:true}).click();};
      await page.goto(base+'/groups');await page.locator('#treasury-shop-form').waitFor();await idle();await balance(200);
      const beforeReserve=calls.reserve,beforeCommit=calls.commit;await prepare('browser-fern');assert.equal(calls.reserve,beforeReserve);
      assert.equal(await page.getByRole('button',{name:'Confirm purchase',exact:true}).isDisabled(),true);assert.equal(await page.locator('#treasury-shop img').count(),0);
      dropReserve=true;await confirm('Confirm purchase');await page.getByRole('button',{name:'Check purchase status',exact:true}).waitFor();await idle();
      assert.equal(calls.reserve,beforeReserve+1);assert.equal(calls.commit,beforeCommit);
      await page.getByRole('button',{name:'Check purchase status',exact:true}).click();await idle();await confirm('Finish same purchase');
      await page.waitForFunction(()=>!document.querySelector('#treasury-purchase-pending h4'));await balance(120);await idle();assert.equal(calls.commit,beforeCommit+1);
      await page.selectOption('#treasury-frame-choice','fern');await page.click('#treasury-frame-save');
      await page.waitForFunction(()=>document.getElementById('groups-current-panel').dataset.groupFrame==='fern');await idle();
      assert.equal(await page.locator('#groups-current-panel').evaluate(el=>getComputedStyle(el).borderTopColor),'rgb(85, 191, 145)');
      await page.reload();await page.waitForFunction(()=>document.getElementById('groups-current-panel').dataset.groupFrame==='fern');await idle();
      await prepare('browser-entry-'+n);assert.match(await page.locator('#treasury-purchase-pending').innerText(),new RegExp('Linked Territory '+n));
      dropDispatch=true;await confirm('Confirm purchase');await page.getByRole('button',{name:'Check purchase status',exact:true}).waitFor();await idle();
      const entry=()=>db.prepare('SELECT 1 FROM territory_event_registrations WHERE event_id=? AND group_id=?').get(eventId,territoryGroupId);
      assert.equal(entry(),undefined);await page.getByRole('button',{name:'Check purchase status',exact:true}).click();await idle();assert.equal(entry(),undefined);
      await confirm('Finish same purchase');await page.waitForFunction(()=>!document.querySelector('#treasury-purchase-pending h4'));await idle();assert.ok(entry());await balance(100);
      await prepare('browser-cancel-entry-'+n);holdDispatch=true;await confirm('Confirm purchase');await until(()=>heldDispatch);
      await page.getByRole('button',{name:'Release uncommitted funds',exact:true}).click();await idle();heldDispatch();heldDispatch=null;
      assert.equal(db.prepare('SELECT 1 FROM territory_event_registrations WHERE event_id=? AND group_id=?').get(secondEventId,territoryGroupId),undefined);await balance(100);
      await prepare('browser-night');await context.addCookies([{name:'fixture-account',value:B,url:base}]);await page.reload();
      await page.getByText('The current group owner can manage this purchase.',{exact:true}).waitFor();await idle();
      assert.equal(await page.locator('#treasury-shop-form').isVisible(),false);assert.equal(await page.locator('#treasury-frame-form').isVisible(),false);assert.equal(await page.locator('#treasury-purchase-pending button').count(),0);
      await context.addCookies([{name:'fixture-account',value:A,url:base}]);await page.reload();await page.locator('#treasury-purchase-consent').waitFor();await idle();
      holdReserve=true;heldReserve=null;await confirm('Confirm purchase');await until(()=>heldReserve);
      page.once('dialog',dialog=>dialog.accept());await page.click('#groups-leave');await page.locator('#groups-create-panel').waitFor();assert.equal(await page.locator('#treasury-shop').isVisible(),false);
      await context.addCookies([{name:'fixture-account',value:B,url:base}]);await page.reload();await page.getByRole('button',{name:'Release uncommitted funds',exact:true}).waitFor();await idle();
      await page.getByRole('button',{name:'Release uncommitted funds',exact:true}).click();await idle();heldReserve();heldReserve=null;
      await page.waitForTimeout(100);assert.equal(spending.cosmetics(groupId).length,1);await balance(100);
      await prepare('browser-night');dropCommit=true;await confirm('Confirm purchase');await page.getByRole('button',{name:'Check purchase status',exact:true}).waitFor();await idle();
      const paid=calls.commit;await page.getByRole('button',{name:'Check purchase status',exact:true}).click();await idle();await balance(50);assert.equal(calls.commit,paid);
      failCatalog=true;await page.click('#treasury-shop-refresh');await page.getByText('The purchase catalog is unavailable. Saved requests can still be checked or released.',{exact:true}).waitFor();await idle();
      await page.selectOption('#treasury-frame-choice','none');await page.click('#treasury-frame-save');await page.waitForFunction(()=>document.getElementById('groups-current-panel').dataset.groupFrame==='none');await idle();
      failCatalog=false;process.env.GROUP_TREASURY_SPEND_ENABLED='0';await page.reload();await page.getByText('New purchases are unavailable. Existing group purchases and frames remain accessible.',{exact:true}).waitFor();await idle();
      assert.equal(await page.locator('#treasury-shop-form').isVisible(),false);await page.selectOption('#treasury-frame-choice','night');await page.click('#treasury-frame-save');
      await page.waitForFunction(()=>document.getElementById('groups-current-panel').dataset.groupFrame==='night');await idle();assert.equal(economy.getWallet(A).balance,800);assert.equal(economy.getWallet(B).balance,1000);
      assert.equal(await page.locator('#treasury-shop img').count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
      await context.clearCookies();await page.click('#treasury-shop-refresh');await page.waitForFunction(()=>document.getElementById('treasury-shop').hidden);
      assert.equal(await page.locator('#treasury-purchase-history').textContent(),'No group purchases yet.');assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
      console.log(`PASS ${width}px owner cosmetic/Territory purchases, frozen entry review, lost dispatch replies, cancellation races, paid frames, membership and disabled recovery`);await context.close();
    }
  }finally{
    if(heldReserve)heldReserve();if(heldDispatch)heldDispatch();if(browser)await browser.close();await Promise.all([website,accounting].filter(Boolean).map(server=>new Promise(resolve=>server.close(resolve))));
    db.close();economy.db.close();const target=path.resolve(temp);assert.ok(target.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(target,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
