const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.HV_TEST_BROWSER});
  try {
    for(const width of [1440,390]) {
      const context=await browser.newContext({viewport:{width,height:900}});
      const html=fs.readFileSync(path.join(__dirname,'../public/adminterritorywars.html'),'utf8');
      const panel=html.match(/<section class="tw-card" aria-labelledby="victory-delivery-heading">[\s\S]*?<\/section>/)[0];
      let fail=false;const writes=[];
      await context.route('**/*',async route=>{
        const url=new URL(route.request().url());
        if(url.origin!=='http://hv.test') return route.abort();
        if(url.pathname==='/') return route.fulfill({contentType:'text/html',body:panel+'<script src="/review.js"></script>'});
        if(url.pathname==='/review.js') return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(__dirname,'../public/assets/territory-victory-review.js'),'utf8')});
        if(route.request().method()==='POST') {
          writes.push(route.request().postDataJSON());
          return route.fulfill({status:fail?409:200,contentType:'application/json',body:JSON.stringify(fail?{error:'Already delivered'}:{queued:true})});
        }
        return route.fulfill({contentType:'application/json',body:JSON.stringify({deliveries:[{attackId:1,status:'review',attempts:2,errorCode:'http-409'},{attackId:2,status:'delivered',attempts:1}]})});
      });
      const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto('http://hv.test');await page.waitForFunction(()=>!document.getElementById('victory-delivery-retry').disabled);
      assert.deepEqual(await page.locator('#victory-delivery-choice option').evaluateAll(nodes=>nodes.map(n=>n.value)),['1']);
      await page.fill('#victory-delivery-reason','Receiver configuration reviewed');
      await page.click('#victory-delivery-retry');
      await page.waitForFunction(()=>document.getElementById('victory-delivery-status').textContent.startsWith('Retry queued'));
      assert.deepEqual(writes,[{reason:'Receiver configuration reviewed'}]);
      fail=true;await page.fill('#victory-delivery-reason','Receiver configuration reviewed again');
      await page.click('#victory-delivery-retry');
      await page.waitForFunction(()=>document.getElementById('victory-delivery-status').textContent==='Already delivered');
      assert.equal(await page.inputValue('#victory-delivery-reason'),'Receiver configuration reviewed again');
      assert.deepEqual(errors,[]);console.log(`PASS ${width}px: review selection, exact retry payload, success and failure feedback`);
      await context.close();
    }
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
