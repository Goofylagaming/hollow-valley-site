process.env.GROUP_DIPLOMACY_ENABLED='0';
// Local synthetic identities and databases only; no remote account or game access.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require('playwright');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hv-groups-page-'));
process.env.DB_PATH=path.join(temp,'website.sqlite');
process.env.GROUP_HQ_ENABLED='1';process.env.HV_GALLERY_ENABLED='1';
process.env.GROUP_TREASURY_ENABLED='0';
process.env.GROUP_TREASURY_SPEND_ENABLED='0';
for(const key of ['GROUP_HQ_READ_ONLY','SKIN_STUDIO_READ_ONLY','RENDER_SERVICE_ID','RENDER_EXTERNAL_URL','PUBLIC_SITE_URL','STEAM_REALM','STEAM_RETURN_URL'])delete process.env[key];
const express=require('express'),{db}=require('../server/db'),groups=require('../server/groupsStore');
const headquarters=require('../server/services/groupHeadquarters').createGroupHeadquarters(db,groups);
const links=require('../server/services/groupTerritoryLinks').createGroupTerritoryLinks(db,groups);
const provenance=require('../server/services/territoryBattleProvenance').createBattleProvenance(db);
let held=null,holdRead=false,dropWrite=false;
const unexpected=[];
const app=express();app.use(express.json());
app.use((req,_res,next)=>{
  const steam=String(req.headers.cookie||'').match(/(?:^|;\s*)fixture-account=(\d{17})(?:;|$)/)?.[1];
  if(steam)req.user=db.prepare('SELECT * FROM users WHERE steam_id=?').get(steam);
  next();
});
app.get('/api/me',(req,res)=>res.json({loggedIn:Boolean(req.user),user:req.user||null,steamLoginConfigured:true}));
app.use('/api/group-headquarters',(req,res,next)=>{
  if(req.path==='/'&&((req.method==='GET'&&holdRead)||(req.method==='POST'&&dropWrite))){
    const json=res.json.bind(res),drop=req.method==='POST';holdRead=false;dropWrite=false;
    res.json=body=>{if(drop)res.destroy();else held=()=>json(body);return res;};
  }
  next();
});
app.use('/api/group-headquarters',require('../server/routes/groupHeadquarters'));
app.use('/api/groups',require('../server/routes/groups'));
app.use('/api/group-treasury',require('../server/routes/groupTreasury'));
app.use('/api/group-diplomacy',require('../server/routes/groupDiplomacy'));
app.get('/api/gallery/:id/image',(req,res)=>{
  const image=db.prepare("SELECT image FROM gallery_images WHERE id=? AND status='approved'").get(req.params.id);
  if(!image?.image)return res.sendStatus(404);res.type('png').send(Buffer.from(image.image));
});
app.use('/api',(req,res)=>{unexpected.push(req.method+' '+req.path);res.status(404).json({error:'Unexpected fixture API'});});
app.get('/groups',(_req,res)=>res.sendFile(path.join(__dirname,'../public/groups.html')));
app.use(express.static(path.join(__dirname,'../public')));
db.exec(`CREATE TABLE territory_groups(id INTEGER PRIMARY KEY,name TEXT,leader_user_id INTEGER);
  CREATE TABLE gallery_images(id TEXT PRIMARY KEY,owner_steam_id TEXT,author TEXT,title TEXT,status TEXT,image BLOB);`);
async function until(predicate){for(let i=0;i<200;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Fixture observation timed out');}
(async()=>{
  let server,browser;
  try{
    server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
    const base='http://127.0.0.1:'+server.address().port;
    browser=await chromium.launch({headless:true,executablePath:process.env.HV_TEST_BROWSER});
    let fixtureNumber=0;
    for(const width of [1440,390]){
      const n=++fixtureNumber,A='76561198000000'+n+'01',B='76561198000000'+n+'02',D='76561198000000'+n+'04';
      for(const [steam,name]of[[A,'Owner <img src=x>'],[B,'Member'],[D,'Invitee']])db.prepare('INSERT INTO users(steam_id,username) VALUES(?,?)').run(steam,name);
      const groupId=groups.createGroup(A,'Fixture Pack '+n).current.id;
      groups.invite(A,B);groups.actOnInvite(B,groups.getState(B).incoming[0].id,'accept');
      headquarters.update(A,{expectedGroupId:groupId,description:'Original description',emblem:'leaf',expectedRevision:0});
      const territoryId=n*10;
      db.prepare('INSERT INTO territory_groups VALUES(?,?,?)').run(territoryId,'Territory Pack '+n,db.prepare('SELECT id FROM users WHERE steam_id=?').get(A).id);
      links.set(A,{expectedGroupId:groupId,territoryGroupId:territoryId,expectedRevision:0});
      const at=Date.now()-60000;provenance.begin(n,n,at,{attackerGroupId:territoryId});
      provenance.observe(n,{usable:true},at+1000);provenance.finish(n,at+2000,'capture');
      const imageId='image-'+n;
      db.prepare('INSERT INTO gallery_images VALUES(?,?,?,?,?,?)').run(imageId,A,'Owner','Screenshot <img src=x>','approved',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6S0cAAAAASUVORK5CYII=','base64'));
      const context=await browser.newContext({viewport:{width,height:1000}});
      await context.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{document.body.dataset.suppressDailyClaim='true';}));
      await context.addCookies([{name:'fixture-account',value:A,url:base}]);
      await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
      const page=await context.newPage(),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
      const checkLayout=async()=>{
        const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().width&&el.getBoundingClientRect().right>innerWidth+1).map(el=>({tag:el.tagName,id:el.id,class:el.className,right:el.getBoundingClientRect().right})).slice(0,15)}));
        assert.ok(layout.scroll<=layout.width+1,JSON.stringify(layout));
      };
      await page.goto(base+'/groups');
      await page.getByText('You can edit your group description.',{exact:true}).waitFor();
      await page.locator('#groups-achievements .is-complete').first().waitFor();
      await page.waitForFunction(()=>document.getElementById('hq-battles').textContent.includes('Attacking · Win'));
      assert.equal(await page.locator('#groups-owner-panel').isVisible(),true);
      assert.equal(await page.locator('#hq-name img').count(),0);
      assert.equal(await page.locator('#groups-members img').count(),0);
      await checkLayout();
      await page.fill('#hq-description','Unfinished group description');await page.selectOption('#hq-emblem-choice','sun');
      await page.locator('#hq-ranks select').selectOption('veteran');await page.getByRole('button',{name:'Save rank',exact:true}).click();
      await page.waitForFunction(()=>document.getElementById('hq-ranks').textContent.includes('· veteran'));
      assert.equal(await page.inputValue('#hq-description'),'Unfinished group description');
      await page.click('#hq-share');await page.locator('#hq-screenshots figure').waitFor();
      await checkLayout();
      await page.getByRole('button',{name:'Remove screenshot',exact:true}).click();
      await page.waitForFunction(()=>!document.querySelector('#hq-screenshots figure'));
      assert.equal(await page.inputValue('#hq-description'),'Unfinished group description');assert.equal(await page.inputValue('#hq-emblem-choice'),'sun');
      await page.fill('#groups-steam-id',D);await page.locator('#groups-invite-form button').click();
      await page.getByText('Group updated.',{exact:true}).waitFor();await until(()=>groups.getState(D).incoming.length===1);
      await page.waitForFunction(()=>!document.getElementById('hq-refresh').disabled);
      assert.equal(await page.inputValue('#hq-description'),'Unfinished group description');
      headquarters.update(A,{expectedGroupId:groupId,description:'Concurrent saved version',emblem:'mountain',expectedRevision:1});
      await page.click('#hq-refresh');
      await page.getByText('The saved description changed. Your draft is kept; discard it to load the latest version.',{exact:true}).waitFor();
      await page.click('#hq-save');await page.getByText('Headquarters changed; refresh before saving',{exact:true}).waitFor();
      assert.equal(headquarters.get(A).description,'Concurrent saved version');
      assert.equal(await page.inputValue('#hq-description'),'Unfinished group description');
      await page.click('#hq-discard');await page.waitForFunction(()=>document.getElementById('hq-description').value==='Concurrent saved version');
      await page.fill('#hq-description','Saved despite a lost response');dropWrite=true;await page.click('#hq-save');
      await page.waitForFunction(()=>document.getElementById('hq-current').textContent==='Saved despite a lost response'&&!document.getElementById('hq-refresh').disabled);
      assert.equal(headquarters.get(A).revision,3);assert.equal(await page.locator('#hq-discard').isDisabled(),true);
      // Actual member view uses the same page, account middleware and data.
      await context.addCookies([{name:'fixture-account',value:B,url:base}]);await page.reload();
      await page.getByText('The group owner can edit this description.',{exact:true}).waitFor();
      await page.getByText(`Linked Territory Wars group #${territoryId}.`,{exact:true}).waitFor();
      assert.equal(await page.locator('#hq-editor').isVisible(),false);assert.equal(await page.locator('#hq-ranks select').count(),0);
      assert.equal(await page.locator('#hq-territory-form').isVisible(),false);
      await context.addCookies([{name:'fixture-account',value:A,url:base}]);await page.reload();
      await page.getByText('You can edit your group description.',{exact:true}).waitFor();
      holdRead=true;held=null;await page.click('#hq-refresh');await until(()=>held);
      page.once('dialog',dialog=>dialog.accept());await page.click('#groups-leave');
      await page.locator('#groups-create-panel').waitFor();
      assert.equal(await page.locator('#group-headquarters').isVisible(),false);
      await page.fill('#groups-name','Replacement Pack '+n);await page.locator('#groups-create-form button').click();
      await page.waitForFunction(name=>document.getElementById('hq-name').textContent===name,'Replacement Pack '+n);
      held();held=null;
      await page.waitForTimeout(100);
      assert.equal(await page.locator('#hq-name').textContent(),'Replacement Pack '+n);
      assert.equal(await page.inputValue('#hq-description'),'');assert.equal(await page.locator('#hq-history li').count(),0);
      const stale=await context.request.post(base+'/api/group-headquarters',{headers:{Origin:base},data:{description:'Delayed old-group write',emblem:'leaf',expectedRevision:0,expectedGroupId:groupId}});
      assert.equal(stale.status(),409);assert.equal(headquarters.get(A).description,'');
      process.env.GROUP_HQ_READ_ONLY='1';await page.reload();await page.getByText('This preview is read-only.',{exact:true}).first().waitFor();
      assert.equal(await page.locator('#hq-save').isDisabled(),true);assert.equal(await page.locator('#hq-territory-save').isDisabled(),true);
      delete process.env.GROUP_HQ_READ_ONLY;
      process.env.GROUP_HQ_ENABLED='0';await page.reload();await page.locator('#groups-current-panel').waitFor();
      assert.equal(await page.locator('#group-headquarters').isVisible(),false);process.env.GROUP_HQ_ENABLED='1';
      await context.clearCookies();await page.reload();await page.locator('#groups-signin').waitFor();
      assert.equal(await page.locator('#groups-app').isVisible(),false);
      await checkLayout();
      assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
      console.log(`PASS ${width}px real Groups page/routes: achievements, drafts, conflicts, lost save response, membership replacement, preview, disabled and guest states`);
      await context.close();
    }
  }finally{
    if(held)held();if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));
    db.close();
    const root=path.resolve(os.tmpdir())+path.sep,target=path.resolve(temp);
    if(!target.startsWith(root))throw new Error('Fixture cleanup escaped temporary directory');
    fs.rmSync(target,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
