const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.HV_TEST_BROWSER});
  try{for(const width of [1440,390]){
    const context=await browser.newContext({viewport:{width,height:1000}});
    let enabled=true,readOnly=false,signedIn=true,settings={enabled:false,revision:0},deleted=false;const writes=[];
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());if(url.origin!=='http://localhost')return route.abort();
      const json=body=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
      if(url.pathname==='/assets/common.js')return route.fulfill({contentType:'text/javascript',body:`window.HDS={api:async(url,options={})=>{const r=await fetch(url,{headers:{'Content-Type':'application/json'},...options});return r.json();},loadMe:()=>window.HDS.api('/api/me')};`});
      if(url.pathname==='/api/me')return json({user:signedIn?{steam_id:'76561198000000801'}:null});
      if(url.pathname.endsWith('/capabilities'))return json({enabled,readOnly,mapBounds:{minX:-607000,maxX:509000,minY:-505000,maxY:607000}});
      if(url.pathname==='/api/journeys/settings'&&route.request().method()==='GET')return json(settings);
      if(url.pathname==='/api/journeys/settings'||url.pathname==='/api/journeys/delete'){
        const body=route.request().postDataJSON();writes.push(body);settings={enabled:body.enabled??false,revision:settings.revision+1};if(url.pathname.endsWith('/delete'))deleted=true;return json(settings);
      }
      if(url.pathname==='/api/journeys/points')return json({points:deleted?[]:[
        {lifeId:'life <img src=x>',at:30000,x:2000,y:1000,breakBefore:1},
        {lifeId:'life <img src=x>',at:20000,x:1000,y:1000,breakBefore:0},
        {lifeId:'life <img src=x>',at:10000,x:0,y:0,breakBefore:1}],nextBefore:null,lives:deleted?[]:[{id:'life <img src=x>',species:'Rex <img src=x>',firstObservedAt:10000,lastObservedAt:30000,endedAt:30000,closureReason:'not_observed'}]});
      const root=path.join(__dirname,'../public'),file=path.join(root,url.pathname==='/journeys'?'journeys.html':url.pathname.slice(1));
      if(!file.startsWith(root)||!fs.existsSync(file))return route.abort();
      return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':file.endsWith('.webp')?'image/webp':'text/javascript'});
    });
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
    await page.goto('http://localhost/journeys');await page.locator('#journey-account').waitFor({state:'visible'});
    assert.equal(await page.locator('#journey-lines path').count(),1);assert.equal(await page.locator('#journey-lines circle').count(),3);
    assert.ok((await page.locator('#journey-life-summary').textContent()).includes('No longer present in the observed snapshot'));
    assert.equal(await page.locator('#journey-life-summary img').count(),0);
    assert.equal(writes.length,0);await page.check('#journey-optin');await page.click('#journey-settings button');await page.getByText('Recording preference saved.',{exact:true}).waitFor();
    assert.deepEqual(writes[0],{enabled:true,expectedRevision:0});
    await page.click('#journey-delete');await page.getByText('Journey history deleted. Recording is off.',{exact:true}).waitFor();
    assert.equal(await page.locator('#journey-optin').isChecked(),false);assert.equal(await page.locator('#journey-lines circle').count(),0);
    assert.equal(await page.locator('#journey-life-summary').textContent(),'');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    readOnly=true;await page.reload();await page.getByText('This preview is read-only.',{exact:true}).waitFor();assert.equal(await page.locator('#journey-delete').isDisabled(),true);
    signedIn=false;await page.reload();await page.locator('#journey-signin').waitFor({state:'visible'});
    enabled=false;await page.reload();await page.getByText('Journey history is not open yet.',{exact:true}).waitFor();
    assert.deepEqual(errors,[]);console.log(`PASS ${width}px: consent, deletion, private trail gaps, read-only, guest, disabled and layout`);await context.close();
  }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
