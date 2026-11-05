// Real local website/accounting routes, synthetic identity cookies and balances.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),express=require('express');
const {chromium}=require('playwright');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hv-treasury-browser-'));
process.env.DB_PATH=path.join(temp,'website.sqlite');process.env.AUTOMATION_DB_PATH=path.join(temp,'economy.sqlite');
process.env.GROUP_TREASURY_ENABLED='1';process.env.GROUP_HQ_ENABLED='0';process.env.HOLLOW_VALLEY_API_TOKEN='synthetic-treasury-browser-token';
for(const key of ['GROUP_TREASURY_READ_ONLY','SKIN_STUDIO_READ_ONLY','RENDER_SERVICE_ID','RENDER_EXTERNAL_URL','PUBLIC_SITE_URL','STEAM_REALM','STEAM_RETURN_URL'])delete process.env[key];
const {db}=require('../server/db'),groups=require('../server/groupsStore'),economy=require('../automation-platform/src/services/economyStore');
const spending=require('../automation-platform/src/services/groupTreasurySpending').createGroupTreasurySpending(economy,{enabled:()=>true});
let dropCoinReply=false,dropPrepareReply=false,failDonation=false,holdDonation=false,heldDonation=null,holdBalance=false,heldBalance=null,failBalance=false,failClosureBegin=false,dropClosureComplete=false;
let donationPosts=0;
const unexpected=[];
const auto=express();auto.use(express.json());
auto.use('/api/website/group-treasury',(req,res,next)=>{
  if(req.path==='/closure-begin'&&failClosureBegin){failClosureBegin=false;return res.status(503).json({error:'Synthetic closure outage'});}
  if(req.path==='/closure-complete'&&dropClosureComplete){dropClosureComplete=false;res.json=()=>{res.destroy();return res;};}
  if(req.path==='/read'&&failBalance)return res.status(503).json({error:'Synthetic balance outage'});
  if(req.path==='/donate'){
    donationPosts++;
    if(failDonation){failDonation=false;return res.status(503).json({error:'Synthetic donation outage'});}
    if(holdDonation){holdDonation=false;heldDonation=()=>next();return;}
    if(dropCoinReply){dropCoinReply=false;res.json=()=>{res.destroy();return res;};}
  }
  next();
});
auto.use('/api/website/group-treasury',require('../automation-platform/src/routes/websiteGroupTreasuryRoutes'));
const app=express();app.use(express.json());
app.use((req,_res,next)=>{const steam=String(req.headers.cookie||'').match(/(?:^|;\s*)fixture-account=(\d{17})(?:;|$)/)?.[1];if(steam)req.user=db.prepare('SELECT * FROM users WHERE steam_id=?').get(steam);next();});
app.get('/api/me',(req,res)=>res.json({loggedIn:Boolean(req.user),user:req.user||null,steamLoginConfigured:true}));
app.use('/api/group-treasury',(req,res,next)=>{
  if(req.path==='/donations'&&req.method==='POST'&&dropPrepareReply){dropPrepareReply=false;res.json=()=>{res.destroy();return res;};}
  if(req.path==='/'&&req.method==='GET'&&holdBalance){holdBalance=false;const json=res.json.bind(res);res.json=body=>{heldBalance=()=>json(body);return res;};}
  next();
});
app.use('/api/group-treasury',require('../server/routes/groupTreasury'));
app.use('/api/group-headquarters',require('../server/routes/groupHeadquarters'));
app.use('/api/groups',require('../server/routes/groups'));
app.use('/api',(req,res)=>{unexpected.push(req.method+' '+req.path);res.status(404).json({error:'Unexpected local API'});});
app.get('/groups',(_req,res)=>res.sendFile(path.join(__dirname,'../public/groups.html')));
app.use(express.static(path.join(__dirname,'../public')));
const listen=app=>new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
async function until(fn){for(let i=0;i<300;i++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Local fixture observation timed out');}
(async()=>{
  let server,accounting,browser;
  try{
    accounting=await listen(auto);process.env.AUTOMATION_SERVICE_URL='http://127.0.0.1:'+accounting.address().port;
    server=await listen(app);const base='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({headless:true,executablePath:process.env.HV_TEST_BROWSER});
    let n=0;
    for(const width of [1440,390]){
      n++;const A=String(76561198000000100n+BigInt(n*10+1)),B=String(76561198000000100n+BigInt(n*10+2));
      process.env.GROUP_TREASURY_ENABLED='1';delete process.env.GROUP_TREASURY_READ_ONLY;
      for(const [steam,name]of[[A,'Treasury donor'],[B,'Other member']])db.prepare('INSERT INTO users(steam_id,username) VALUES(?,?)').run(steam,name);
      const groupId=groups.createGroup(A,`Pack ${n} <img src=x>`).current.id;groups.invite(A,B);groups.actOnInvite(B,groups.getState(B).incoming[0].id,'accept');
      economy.applyWalletTransaction({steamId:A,amount:1000,kind:'fixture',reason:'Synthetic browser balance',idempotencyKey:'fixture:'+A});
      const context=await browser.newContext({viewport:{width,height:1000}});
      await context.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{document.body.dataset.suppressDailyClaim='true';}));
      await context.addCookies([{name:'fixture-account',value:A,url:base}]);
      await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
      const page=await context.newPage(),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
      const idle=()=>page.waitForFunction(()=>!document.getElementById('treasury-refresh').disabled);
      const balance=value=>page.waitForFunction(text=>document.getElementById('treasury-balance').textContent===text,`${value} Valley Coins`);
      const prepare=async amount=>{await idle();await page.fill('#treasury-amount',String(amount));await page.click('#treasury-review');await page.getByText(`Review ${amount} Valley Coins to Pack ${n} <img src=x>`,{exact:true}).waitFor();await idle();};
      const confirm=async()=>{await page.check('#treasury-consent');await page.getByRole('button',{name:'Confirm donation',exact:true}).click();};
      await page.goto(base+'/groups');await balance(0);await idle();assert.equal(donationPosts,(n-1)*3);
      assert.equal(await page.locator('#groups-cancel-closure').isVisible(),false);
      assert.equal(await page.locator('#group-treasury img').count(),0);
      await prepare(100);assert.equal(economy.getWallet(A).balance,1000);
      assert.equal(await page.getByRole('button',{name:'Confirm donation',exact:true}).isDisabled(),true);
      dropCoinReply=true;const before=donationPosts;await confirm();
      await page.getByRole('button',{name:'Check status',exact:true}).waitFor();await idle();assert.equal(economy.getWallet(A).balance,900);
      await page.getByRole('button',{name:'Check status',exact:true}).click();await balance(100);await idle();
      assert.equal(await page.locator('#treasury-pending h3').count(),0);assert.equal(donationPosts,before+1);
      const cosmetic={id:'browser-fern-frame',revision:1,title:'Synthetic frame',description:'Local test fixture only',cost:60,purpose:'group_cosmetic',target:{kind:'profile_frame',value:'fern'}};
      spending.register(cosmetic,A);spending.setEnabled(cosmetic.id,1,true,A);
      const hold={groupId,actorSteamId:A,itemId:cosmetic.id,revision:1,expectedCost:60,requestId:'browser_hold_'+n};spending.reserve(hold);
      await page.click('#treasury-refresh');await page.getByText('Available to spend: 40 Valley Coins · Reserved: 60 Valley Coins',{exact:true}).waitFor();await idle();
      spending.release(hold);await page.click('#treasury-refresh');await idle();assert.equal(await page.locator('#treasury-reserved').isVisible(),false);
      page.once('dialog',dialog=>dialog.accept());await page.click('#groups-disband');
      await page.getByText('Resolve Treasury funds and reserved spending before closing the group',{exact:true}).waitFor();await idle();
      assert.equal(groups.getState(A).current.id,groupId);assert.equal(economy.getWallet(A).balance,900);
      failClosureBegin=true;page.once('dialog',dialog=>dialog.accept());await page.click('#groups-disband');
      await page.locator('#groups-cancel-closure').waitFor();await page.getByText('A Treasury closure check is pending. Finish or cancel it in Groups.',{exact:true}).waitFor();await idle();
      assert.equal(await page.locator('#groups-leave').isDisabled(),true);assert.equal(await page.locator('#treasury-form').isVisible(),false);
      await page.click('#groups-cancel-closure');await page.waitForFunction(()=>document.getElementById('groups-cancel-closure').hidden);await idle();await page.locator('#treasury-form').waitFor();
      assert.equal(await page.locator('#groups-cancel-closure').isVisible(),false);
      await prepare(200);await page.getByRole('button',{name:'Cancel request',exact:true}).click();await idle();
      assert.equal(economy.getWallet(A).balance,900);
      await prepare(50);holdDonation=true;heldDonation=null;await confirm();await until(()=>heldDonation);
      await page.getByRole('button',{name:'Cancel request',exact:true}).click();await idle();heldDonation();heldDonation=null;
      await page.waitForTimeout(100);assert.equal(economy.getWallet(A).balance,900);assert.equal(await page.locator('#treasury-pending h3').count(),0);
      await prepare(75);failDonation=true;await confirm();await page.getByRole('button',{name:'Check status',exact:true}).waitFor();await idle();
      process.env.GROUP_TREASURY_ENABLED='0';await page.reload();await page.getByRole('button',{name:'Cancel uncommitted donation',exact:true}).waitFor();await idle();
      assert.equal(await page.locator('#treasury-form').isVisible(),false);
      failBalance=true;await page.click('#treasury-refresh');await page.getByText('The group balance is unavailable. Your saved requests are still shown.',{exact:true}).waitFor();await idle();
      await page.getByRole('button',{name:'Cancel uncommitted donation',exact:true}).click();await idle();assert.equal(await page.locator('#treasury-pending h3').count(),0);
      failBalance=false;await page.click('#treasury-refresh');await balance(100);
      // A non-donating member retains access to a funded group when rollout stops.
      await context.addCookies([{name:'fixture-account',value:B,url:base}]);await page.reload();await balance(100);await idle();
      assert.equal(await page.locator('#treasury-form').isVisible(),false);
      await context.addCookies([{name:'fixture-account',value:A,url:base}]);process.env.GROUP_TREASURY_ENABLED='1';process.env.GROUP_TREASURY_READ_ONLY='1';
      await page.reload();await balance(100);await idle();assert.equal(await page.locator('#treasury-review').isDisabled(),true);
      delete process.env.GROUP_TREASURY_READ_ONLY;await page.reload();await balance(100);await idle();
      dropPrepareReply=true;await page.fill('#treasury-amount','80');await page.click('#treasury-review');
      await page.getByText(`Review 80 Valley Coins to Pack ${n} <img src=x>`,{exact:true}).waitFor();await idle();assert.equal(economy.getWallet(A).balance,900);
      // Recovery can overtake a slow balance refresh because it uses saved consent.
      holdBalance=true;heldBalance=null;await page.click('#treasury-refresh');await until(()=>heldBalance);
      await page.getByRole('button',{name:'Cancel request',exact:true}).click();await idle();heldBalance();heldBalance=null;
      await page.waitForTimeout(100);assert.equal(await page.locator('#treasury-pending h3').count(),0);
      await prepare(90);
      holdBalance=true;heldBalance=null;await page.click('#treasury-refresh');await until(()=>heldBalance);
      page.once('dialog',dialog=>dialog.accept());await page.click('#groups-leave');await page.locator('#groups-create-panel').waitFor();
      await page.getByText('Join a group to view its Treasury.',{exact:true}).waitFor();await idle();heldBalance();heldBalance=null;
      await page.waitForTimeout(100);assert.equal(await page.locator('#treasury-balance').textContent(),'Unavailable');
      assert.equal(await page.getByRole('button',{name:'Confirm donation',exact:true}).count(),0);
      await page.getByRole('button',{name:'Cancel request',exact:true}).click();await idle();assert.equal(economy.getWallet(A).balance,900);
      await page.fill('#groups-name','Empty Closure Pack '+n);await page.locator('#groups-create-form button').click();await balance(0);await idle();
      dropClosureComplete=true;page.once('dialog',dialog=>dialog.accept());await page.click('#groups-disband');
      await page.getByRole('button',{name:'Finish closure check',exact:true}).waitFor();assert.equal(groups.getState(A).current,null);
      await page.getByRole('button',{name:'Finish closure check',exact:true}).click();await page.waitForFunction(()=>document.getElementById('groups-closure-recovery').hidden);await idle();
      assert.equal(await page.locator('#groups-closure-recovery').isVisible(),false);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
      assert.equal(await page.locator('#group-treasury img').count(),0);
      await context.clearCookies();await page.click('#treasury-refresh');
      await page.waitForFunction(()=>document.getElementById('group-treasury').hidden);
      assert.equal(await page.locator('#treasury-history').textContent(),'No donation requests yet.');
      await page.reload();await page.locator('#groups-signin').waitFor();assert.equal(await page.locator('#group-treasury').isVisible(),false);
      assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
      console.log(`PASS ${width}px real Treasury controls: consent, recovery, closure blocking/cancellation/completion, disabled/member/preview states and membership loss`);
      await context.close();
    }
  }finally{
    if(heldDonation)heldDonation();if(heldBalance)heldBalance();if(browser)await browser.close();
    await Promise.all([server,accounting].filter(Boolean).map(server=>new Promise(resolve=>server.close(resolve))));db.close();economy.db.close();
    const target=path.resolve(temp);assert.ok(target.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(target,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
