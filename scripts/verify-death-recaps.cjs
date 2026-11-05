const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless:true, executablePath:process.env.HV_TEST_BROWSER });
  try {
    for (const width of [1440,390]) {
      const context = await browser.newContext({ viewport:{width,height:1000} });
      let enabled=true, signedIn=true, empty=false, failed=false;
      const requests=[];
      await context.route('**/*', async route => {
        const url=new URL(route.request().url()); if(url.origin!=='http://localhost')return route.abort();
        const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
        if(url.pathname==='/assets/common.js')return route.fulfill({contentType:'text/javascript',body:`window.HDS={api:async(u,o={})=>{const r=await fetch(u,o);const b=await r.json();if(!r.ok)throw new Error(b.error);return b;},loadMe:()=>window.HDS.api('/api/me')};`});
        if(url.pathname==='/api/me')return json({user:signedIn?{steam_id:'76561198000000801'}:null});
        if(url.pathname.endsWith('/capabilities'))return json({enabled});
        if(url.pathname==='/api/death-recaps'){
          requests.push(route.request().method());
          if(failed)return json({error:'Fixture unavailable'},503);
          return json({recaps:empty?[]:[{id:'fixture',occurredAt:new Date().toISOString(),attackerName:'<img src=x onerror=alert(1)> '+'W'.repeat(80),victimSpecies:'rex',attackerSpecies:null,growth:null,location:null,dinosaurAge:null,survivalSeconds:null}]});
        }
        const file=path.join(__dirname,'../public',url.pathname==='/death-recaps'?'death-recaps.html':url.pathname.slice(1));
        if(!fs.existsSync(file))return route.abort();
        return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript'});
      });
      const page=await context.newPage(), errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto('http://localhost/death-recaps');await page.locator('#recap-list article').waitFor();
      assert.equal(await page.locator('#recap-list img').count(),0);assert.equal(await page.locator('#recap-list dd').filter({hasText:/^Unknown$/}).count(),5);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      failed=true;await page.click('#recap-refresh');await page.getByText('Fixture unavailable',{exact:true}).waitFor();assert.equal(await page.locator('#recap-list article').count(),0);
      failed=false;empty=true;await page.click('#recap-refresh');await page.getByText('No eligible death records are available yet.',{exact:true}).waitFor();
      signedIn=false;await page.reload();await page.locator('#recap-signin').waitFor({state:'visible'});
      enabled=false;await page.reload();await page.getByText('Death recaps are not open yet.',{exact:true}).waitFor();
      assert.ok(requests.every(method=>method==='GET'));assert.deepEqual(errors,[]);
      console.log(`PASS ${width}px recap fields, safe text, empty/error recovery, guest, disabled and layout`);await context.close();
    }
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
