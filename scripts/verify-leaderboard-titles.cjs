const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.HV_TEST_BROWSER});
  const root=path.join(__dirname,'../public');
  try{for(const width of [1440,390]){
    const context=await browser.newContext({viewport:{width,height:900}});
    let titled=true;
    await context.addInitScript(()=>{window.HDS={api:async url=>(await fetch(url)).json(),escapeHtml:value=>{const span=document.createElement('span');span.textContent=String(value);return span.innerHTML;}};});
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());if(url.origin!=='http://hv.test')return route.abort();
      if(url.pathname==='/api/leaderboards'){
        const row={username:'Fixture Player',level:10,xp:100,kills:5,deaths:1,kd:5,playtime_minutes:60,selectedTitle:titled?{id:'quest-master',name:'Quest Master <img src=x onerror=alert(1)>'}:null};
        return route.fulfill({contentType:'application/json',body:JSON.stringify(Object.fromEntries(['dailyKills','dailyKd','dailyDeaths','weeklyKills','weeklyKd','weeklyDeaths','mostLevels','mostPlaytime'].map(key=>[key,[row]])))});
      }
      if(url.pathname==='/assets/common.js')return route.fulfill({contentType:'text/javascript',body:''});
      const file=path.join(root,url.pathname==='/'?'leaderboard.html':url.pathname.slice(1));
      if(!file.startsWith(root)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.abort();
      return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream',body:fs.readFileSync(file)});
    });
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://hv.test/?tab=levels');
    await page.waitForSelector('.leaderboard-title');
    for(const tab of ['mostLevels','mostKills','bestKd','mostDeaths','mostPlaytime']){
      await page.click(`[data-tab=${tab}]`);
      assert.equal(await page.locator('.leaderboard-title').first().textContent(),'Quest Master <img src=x onerror=alert(1)>');
      assert.equal(await page.locator('#lb-content img').count(),0);
    }
    titled=false;await page.reload();await page.waitForFunction(()=>document.getElementById('lb-content').textContent.includes('Fixture Player'));
    assert.equal(await page.locator('.leaderboard-title').count(),0);
    assert.deepEqual(errors,[]);console.log(`PASS ${width}px: all tabs, escaped title text and untitled fallback`);
    await context.close();
  }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
