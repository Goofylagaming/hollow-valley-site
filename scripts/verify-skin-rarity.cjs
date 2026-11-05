const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.HV_TEST_BROWSER});
  const root=path.join(__dirname,'../public'),html=fs.readFileSync(path.join(root,'skins.html'),'utf8');
  const start=html.indexOf('<section class="skin-panel" id="premium-collection"');
  const panel=html.slice(start,html.indexOf('<section class="skin-panel" data-skin-panel="mine"',start));
  try{for(const width of [1440,390]){
    const context=await browser.newContext({viewport:{width,height:1000}});let fail=true,readOnly=false;const writes=[];
    const skin={id:'fixture-skin',name:'Fixture palette',description:'Reviewed fixture',species:'Rex',collectionKey:'valley-origins',state:'published',published:true,owned:false,rarity:null,rarityRevision:0,rarityHistory:[],swatches:[{zone:'body',color:'#227755'}],verifiedSpecies:['Rex']};
    await context.addInitScript(()=>{
      window.me={loggedIn:true,user:{is_admin:true,steam_id:'76561198000000001'}};window.mineState={presets:[]};window.loadMine=async()=>{};window.showAlert=(text,kind)=>window.lastAlert={text,kind};window.activateSkinTab=()=>{};
      window.HDS={escapeHtml:text=>{const div=document.createElement('div');div.textContent=String(text);return div.innerHTML;},api:async(url,options={})=>{const response=await fetch(url,{headers:{'Content-Type':'application/json'},...options});const body=await response.json();if(!response.ok)throw new Error(body.error);return body;}};
    });
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());if(url.origin!=='http://localhost')return route.abort();
      const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
      if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:`<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/assets/premium-skins.css">${panel}<script src="/assets/premium-skins.js"></script>`});
      if(url.pathname.endsWith('/rarity')){
        const body=route.request().postDataJSON();writes.push(body);if(fail)return json({error:'Fixture service unavailable'},503);
        skin.rarity=body.rarity;skin.rarityRevision++;skin.rarityHistory=[{actor:'76561198000000001',rarity:body.rarity,reason:body.reason,at:'2026-11-05'}];return json({duplicate:false});
      }
      if(url.pathname==='/api/skins/premium/admin')return json({skins:[skin]});
      if(url.pathname==='/api/skins/premium')return json({enabled:true,skins:[{...skin,rarityHistory:undefined}]});
      if(url.pathname==='/api/skins/studio-context')return json({readOnly});
      if(url.pathname==='/api/supporter/rewards')return json({monthly:{enabled:false}});
      const file=path.join(root,url.pathname.slice(1));if(!file.startsWith(root)||!fs.existsSync(file))return route.abort();
      return route.fulfill({contentType:file.endsWith('.css')?'text/css':'text/javascript',body:fs.readFileSync(file)});
    });
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://localhost');
    await page.evaluate(()=>window.HVPremiumSkins.refresh());
    const form=page.locator('[data-premium-rarity]');await form.locator('select').selectOption('rare');
    await form.locator('textarea').fill('Curated rarity <img src=x onerror=alert(1)>');
    await form.getByRole('button',{name:'Save classification'}).click();await page.waitForFunction(()=>window.lastAlert?.kind==='error');
    assert.match(await form.locator('textarea').inputValue(),/Curated rarity/);
    fail=false;await form.getByRole('button',{name:'Save classification'}).click();await page.waitForFunction(()=>document.querySelector('[data-premium-rarity] select').value==='rare'&&document.querySelector('[data-premium-rarity] details').textContent.includes('Curated rarity'));
    assert.deepEqual(writes[0],writes[1]);assert.equal(writes[0].actorSteamId,undefined);
    assert.equal(await page.locator('[data-premium-rarity] details img').count(),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    readOnly=true;await page.evaluate(()=>window.HVPremiumSkins.refresh());assert.equal(await form.locator('select').isDisabled(),true);
    await page.evaluate(()=>{window.me={loggedIn:false,user:null};return window.HVPremiumSkins.refresh();});assert.equal(await page.locator('#premium-admin').isVisible(),false);
    assert.deepEqual(errors,[]);console.log(`PASS ${width}px: rarity save/retry, audit escaping, read-only controls, guest isolation and layout`);await context.close();
  }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
