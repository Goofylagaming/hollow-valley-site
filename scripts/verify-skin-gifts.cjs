const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.HV_TEST_BROWSER});
  try{for(const width of [1440,390]){
    const context=await browser.newContext({viewport:{width,height:1000}}),sender='76561198000000001',recipient='76561198000000002';
    let role=sender,readOnly=false,enabled=true,lost=true;const offers=[],decisions=[],rows=[];
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());if(url.origin!=='http://localhost')return route.abort();
      const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
      if(url.pathname==='/assets/common.js')return route.fulfill({contentType:'text/javascript',body:`window.HDS={api:async(url,options={})=>{const r=await fetch(url,{headers:{'Content-Type':'application/json'},...options});const b=await r.json();if(!r.ok)throw new Error(b.error);return b;},loadMe:()=>window.HDS.api('/api/me')};`});
      if(url.pathname==='/api/me')return json({user:role?{steam_id:role}:null});
      if(url.pathname.endsWith('/capabilities'))return json({enabled,readOnly});
      if(url.pathname.endsWith('/eligible'))return json({skins:role===sender&&!rows.some(r=>r.state==='pending')?[{id:'skin',name:'Forest <img src=x>',species:'Triceratops'}]:[]});
      if(url.pathname==='/api/skins/gifts')return json({gifts:rows});
      if(url.pathname.endsWith('/offer')){
        const body=route.request().postDataJSON();offers.push(body);
        if(!rows.some(r=>r.requestId===body.requestId))rows.push({id:`gift-${rows.length}`,requestId:body.requestId,presetId:'skin',name:'Forest <img src=x>',sender,recipient,note:body.note,state:'pending',revision:0,expiresAt:Date.now()+86400000});
        if(lost){lost=false;return json({error:'Fixture acknowledgement lost'},503);}return json({id:rows.at(-1).id});
      }
      if(url.pathname.endsWith('/decide')){const body=route.request().postDataJSON();decisions.push(body);rows.find(r=>r.id===body.id).state=body.decision;return json({duplicate:false});}
      const root=path.join(__dirname,'../public'),file=path.join(root,url.pathname==='/skin-gifts'?'skin-gifts.html':url.pathname.slice(1));
      if(!file.startsWith(root)||!fs.existsSync(file))return route.abort();return route.fulfill({contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript',body:fs.readFileSync(file)});
    });
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
    await page.goto('http://localhost/skin-gifts');await page.waitForFunction(()=>!document.querySelector('#gift-offer button').disabled);
    async function fill(){await page.selectOption('[name=presetId]','skin');await page.fill('[name=recipientSteamId]',recipient);await page.fill('[name=note]','A gift <img src=x onerror=alert(1)>');await page.check('[name=confirmed]');}
    await fill();await page.click('#gift-offer button');await page.getByText('Fixture acknowledgement lost',{exact:true}).waitFor();
    assert.equal(await page.inputValue('[name=recipientSteamId]'),recipient);
    await page.click('#gift-offer button');await page.getByRole('button',{name:'Cancel offer',exact:true}).waitFor();assert.deepEqual(offers[0],offers[1]);
    assert.equal(await page.locator('#gift-list img').count(),0);assert.equal(offers[0].steamId,undefined);
    await page.getByRole('button',{name:'Cancel offer',exact:true}).click();await page.getByText('Gift offer cancelled.',{exact:true}).waitFor();
    await page.waitForFunction(()=>document.querySelector('[name=presetId]').options.length===2);await fill();await page.click('#gift-offer button');await page.getByRole('button',{name:'Cancel offer',exact:true}).waitFor();
    role=recipient;await page.reload();await page.getByRole('button',{name:'Accept gift',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Cancel offer',exact:true}).count(),0);
    await page.getByRole('button',{name:'Accept gift',exact:true}).click();await page.getByText('Gift accepted. The skin is now in My Skins.',{exact:true}).waitFor();
    assert.equal(decisions.at(-1).decision,'accepted');assert.equal(decisions.at(-1).expectedRevision,0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    readOnly=true;role=sender;await page.reload();await page.getByText('This preview is read-only. You can browse gifts, but cannot change them.',{exact:true}).waitFor();assert.equal(await page.locator('#gift-offer button').isDisabled(),true);
    role=null;await page.reload();await page.locator('#gift-signin').waitFor({state:'visible'});assert.equal(await page.locator('#gift-account').isVisible(),false);
    enabled=false;await page.reload();await page.getByText('Skin gifting is not open yet.',{exact:true}).waitFor();
    assert.deepEqual(errors,[]);console.log(`PASS ${width}px: offer retry, cancellation, recipient acceptance, safe text, preview, guest, disabled state and layout`);await context.close();
  }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
