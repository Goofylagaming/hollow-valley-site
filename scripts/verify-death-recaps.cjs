'use strict';
// Actual private website/source routes with synthetic accounts and retained logs.
const { chromium } = require('playwright');
const express = require('express'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict'), { DatabaseSync } = require('node:sqlite'), { randomBytes } = require('node:crypto');
const { createDeathRecapsRouter } = require('../server/routes/deathRecaps');
const A = '76561198000000801', B = '76561198000000802';
const listen = app => new Promise(resolve => { const server = app.listen(0,'127.0.0.1',() => resolve({server,url:'http://127.0.0.1:'+server.address().port})); });
const until = async predicate => { const limit=Date.now()+10000;while(!predicate()){if(Date.now()>limit)throw Error('Fixture state did not arrive');await new Promise(resolve=>setTimeout(resolve,20));} };
(async () => {
  const keys=['DEATH_RECAP_ENABLED','HOLLOW_VALLEY_API_TOKEN','AUTOMATION_SERVICE_URL','COMBAT_FEED_SOURCE'];
  const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  Object.assign(process.env,{DEATH_RECAP_ENABLED:'1',HOLLOW_VALLEY_API_TOKEN:randomBytes(32).toString('hex'),COMBAT_FEED_SOURCE:'recap-fixture'});
  const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY,steam_id TEXT);CREATE TABLE combat_events(id TEXT PRIMARY KEY,occurred_at TEXT,killer_name TEXT,killer_steam_id TEXT,victim_steam_id TEXT,source TEXT,victim_species TEXT,killer_species TEXT,victim_growth REAL,event_location TEXT)');
  db.prepare('INSERT INTO users VALUES(1,?),(2,?)').run(A,B);
  const put=db.prepare('INSERT INTO combat_events VALUES(?,?,?,?,?,?,?,?,?,?)'),at=Date.now();
  put.run('private-owned',new Date(at-600000).toISOString(),'<img src=x onerror=alert(1)> '+'W'.repeat(80),B,A,'recap-fixture','tyrannosaurus',null,null,'{"x":0,"y":-1000}');
  put.run('foreign-owner',new Date(at-600000).toISOString(),'Foreign-only evidence',A,B,'recap-fixture',null,null,null,null);
  put.run('manual-owned',new Date(at-600000).toISOString(),'Manual evidence must not appear',B,A,'manual',null,null,null,null);
  put.run('recent-owned',new Date(at-1000).toISOString(),'Undisclosed recent evidence',B,A,'recap-fixture',null,null,null,null);
  put.run('earlier-kill',new Date(at-660000).toISOString(),'Other player',A,B,'recap-fixture',null,null,null,null);
  const legacy=require('../automation-platform/src/services/valleyLegacyService'),original=legacy.get;legacy.get=()=>({db});
  let source,website,browser,enabled=true,current=1,failed=false,hold=false,held=false,release=null;
  const captures=fs.mkdtempSync(path.join(os.tmpdir(),'hv-recap-privacy-browser-'));
  try {
    const internal=express();internal.use(express.json());internal.use('/api/website/legacy/death-recaps',require('../automation-platform/src/routes/deathRecapRoutes'));source=await listen(internal);
    process.env.AUTOMATION_SERVICE_URL=source.url;
    const actualClient=require('../server/services/automationWebsiteClient');
    const client={legacyRequest:async(...args)=>{if(failed)throw Object.assign(Error('fixture unavailable'),{status:503});const value=await actualClient.legacyRequest(...args);if(hold){held=true;await new Promise(resolve=>{release=resolve;});held=false;}return value;}};
    const app=express();
    app.get('/assets/common.js',(_req,res)=>res.type('js').send(`window.HDS={api:async(u,o={})=>{const r=await fetch(u,o);const b=await r.json();if(!r.ok)throw Object.assign(Error(b.error),{status:r.status});return b;}};`));
    app.get('/api/me',(_req,res)=>{res.set('Cache-Control','private, no-store');const user=current&&db.prepare('SELECT * FROM users WHERE id=?').get(current);res.json({loggedIn:Boolean(user),user:user||null});});
    app.use('/api/death-recaps',(req,_res,next)=>{req.user=current?db.prepare('SELECT * FROM users WHERE id=?').get(current):null;next();},createDeathRecapsRouter({db,client,enabled:()=>enabled}));
    app.get('/death-recaps',(_req,res)=>res.sendFile(path.resolve(__dirname,'../public/death-recaps.html')));
    app.use(express.static(path.resolve(__dirname,'../public')));website=await listen(app);
    browser=await chromium.launch({headless:true,executablePath:process.env.HV_TEST_BROWSER});
    for(const width of [1440,390]){
      current=1;enabled=true;failed=false;hold=false;
      const context=await browser.newContext({viewport:{width,height:1000}});
      await context.route('**/*',route=>new URL(route.request().url()).origin===website.url?route.continue():route.abort());
      await context.addInitScript(()=>{let offset=0;const original=performance.now.bind(performance);Object.defineProperty(performance,'now',{value:()=>original()+offset});window.advanceRecapView=()=>{offset+=120001;};});
      const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',req=>{if(new URL(req.url()).pathname.startsWith('/api/'))requests.push(req);});
      await page.goto(website.url+'/death-recaps');await page.locator('#recap-list article').waitFor();
      assert.equal(await page.locator('#recap-list article').count(),1);assert.equal(await page.locator('#recap-list img').count(),0);
      assert.equal(await page.locator('#recap-list dd').filter({hasText:/^Unknown$/}).count(),5);
      assert.equal(await page.locator('#recap-list li').count(),2);
      assert.equal((await page.locator('#recap-list').innerText()).includes('Manual evidence'),false);
      assert.equal((await page.locator('#recap-list').innerText()).includes('Foreign-only evidence'),false);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      const screenshot=path.join(captures,'recaps-'+width+'.png');await page.screenshot({path:screenshot,fullPage:true});
      failed=true;await page.click('#recap-refresh');await page.getByText('Death recaps are temporarily unavailable',{exact:true}).waitFor();assert.equal(await page.locator('#recap-list article').count(),0);failed=false;
      // A source response held across a relink cannot return the prior account's evidence.
      hold=true;await page.click('#recap-refresh');await until(()=>held);db.prepare('UPDATE users SET steam_id=? WHERE id=1').run(B);hold=false;release();
      await page.getByText('Your linked account changed. Reload this page.',{exact:true}).waitFor();assert.equal(await page.locator('#recap-list article').count(),0);db.prepare('UPDATE users SET steam_id=? WHERE id=1').run(A);
      // Changing sessions without changing the old database row is caught by fresh /me.
      hold=true;await page.click('#recap-refresh');await until(()=>held);current=2;hold=false;release();
      await page.getByText('Your account changed. Refresh before viewing death recaps.',{exact:true}).waitFor();assert.equal(await page.locator('#recap-list article').count(),0);current=1;
      await page.click('#recap-refresh');await page.locator('#recap-list article').waitFor();
      const recapReads=requests.filter(req=>new URL(req.url()).pathname==='/api/death-recaps').length;
      await page.evaluate(()=>window.advanceRecapView());await page.getByText('This private recap view expired. Refresh to view your records.',{exact:true}).waitFor();
      assert.equal(requests.filter(req=>new URL(req.url()).pathname==='/api/death-recaps').length,recapReads);assert.equal(await page.locator('#recap-list article').count(),0);
      db.prepare("UPDATE combat_events SET source='withheld-fixture' WHERE id='private-owned'").run();
      await page.click('#recap-refresh');await page.getByText('No eligible death records are available yet.',{exact:true}).waitFor();
      db.prepare("UPDATE combat_events SET source='recap-fixture' WHERE id='private-owned'").run();
      await page.click('#recap-refresh');await page.locator('#recap-list article').waitFor();
      // Headless Chromium does not background tabs reliably. Exercise the page's
      // visibility-event contract explicitly, including an already-pending read.
      hold=true;await page.click('#recap-refresh');await until(()=>held);
      await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});});
      hold=false;release();await page.getByText('Private death recaps cleared. Refresh when you return.',{exact:true}).waitFor();
      assert.equal(await page.locator('#recap-list article').count(),0);
      await page.click('#recap-refresh');await page.locator('#recap-list article').waitFor();
      await page.evaluate(()=>window.dispatchEvent(new Event('focus')));assert.equal(await page.locator('#recap-list article').count(),0);
      await page.click('#recap-refresh');await page.locator('#recap-list article').waitFor();
      current=0;await page.reload();await page.locator('#recap-signin').waitFor({state:'visible'});assert.equal(await page.locator('#recap-list article').count(),0);
      enabled=false;await page.reload();await page.getByText('Death recaps are not open yet.',{exact:true}).waitFor();
      assert.deepEqual(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length})),{local:0,session:0});
      assert.ok(requests.every(req=>req.method()==='GET'));assert.deepEqual(errors,[]);
      console.log(JSON.stringify({width,deathRecapPrivacy:'passed',screenshot}));await context.close();
    }
  } finally {
    hold=false;release?.();if(browser)await browser.close();for(const surface of [website,source])if(surface)await new Promise(resolve=>surface.server.close(resolve));
    legacy.get=original;db.close();for(const [key,value] of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
