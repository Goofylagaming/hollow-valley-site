const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.HV_TEST_BROWSER});
  try {for(const width of [1440,390]) {
    const context=await browser.newContext({viewport:{width,height:900}});
    const html=fs.readFileSync(path.join(__dirname,'../public/adminoperations.html'),'utf8');
    const panel=html.match(/<section class="ops-panel" id="achievement-review">[\s\S]*?<\/section>/)[0];
    const writes=[];let failed=true;
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin!=='http://localhost')return route.abort();
      if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width, initial-scale=1">'+panel+'<script src="/review.js"></script>'});
      if(url.pathname==='/review.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(__dirname,'../public/assets/achievement-review.js'),'utf8')});
      if(route.request().method()==='POST'){
        writes.push(route.request().postDataJSON());
        return route.fulfill({status:failed?502:200,contentType:'application/json',body:JSON.stringify(failed?{error:'Connection interrupted; retry your decision'}:{duplicate:true})});
      }
      return route.fulfill({contentType:'application/json',body:JSON.stringify({reviews:[{steamId:'76561198000000881',achievementId:'nested-adult',revision:3,awardStatus:'active',pendingCount:1,evidence:[{kind:'combat-death',id:'<img src=x onerror=alert(1)>',detectedAt:1,status:'pending'}],decisions:[]}]})});
    });
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://localhost');
    assert.equal(await page.locator('button[type=submit]').isDisabled(),true);
    await page.click('[data-refresh]');await page.waitForFunction(()=>document.querySelector('select').options.length===2);
    await page.selectOption('select[aria-label="Achievement review"]','0');
    assert.equal(await page.locator('[data-details] img').count(),0,'evidence is rendered as text');
    await page.selectOption('[name=decision]','withdraw');await page.fill('[name=reason]','Verified death before adulthood');
    await page.click('button[type=submit]');await page.waitForFunction(()=>document.querySelector('[role=status]').textContent.startsWith('Connection interrupted'));
    assert.equal(await page.inputValue('[name=reason]'),'Verified death before adulthood');
    failed=false;await page.click('button[type=submit]');await page.waitForFunction(()=>document.querySelector('[role=status]').textContent==='Decision recorded.');
    assert.deepEqual(writes[0],writes[1],'network retry keeps the exact request ID and decision');
    assert.equal(writes[0].expectedRevision,3);assert.equal(writes[0].actorSteamId,undefined);
    assert.equal(await page.inputValue('[name=reason]'),'');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(errors,[]);console.log(`PASS ${width}px: evidence escaping, decision selection, failure preservation, idempotent retry and layout`);
    await context.close();
  }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
