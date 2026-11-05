const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.HV_TEST_BROWSER});
  try{for(const width of [1440,390]){
    const context=await browser.newContext({viewport:{width,height:1000}});
    let enabled=true,readOnly=false,role='admin',failIssue=true,failRedeem=true;const writes=[],codes=[];
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());if(url.origin!=='http://localhost')return route.abort();
      const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
      if(url.pathname==='/assets/common.js')return route.fulfill({contentType:'text/javascript',body:`window.HDS={api:async(url,options={})=>{const r=await fetch(url,{headers:{'Content-Type':'application/json'},...options});const b=await r.json();if(!r.ok)throw Object.assign(new Error(b.error),{status:r.status});return b;},loadMe:()=>window.HDS.api('/api/me')};`});
      if(url.pathname==='/api/me')return json({user:role==='guest'?null:{steam_id:'76561198000000001',is_admin:role==='admin'}});
      if(url.pathname.endsWith('/capabilities'))return json({enabled,readOnly});
      if(url.pathname==='/api/skins/mine')return json({presets:[{id:'mine',name:'Own design <img src=x>',active:true,owner_steam_id:'76561198000000001'},{id:'other',name:'Other creator',active:true,owner_steam_id:'76561198000000002'},{id:'membership',name:'Membership',active:true,owner_steam_id:'76561198000000001',membershipPremium:true}]});
      if(url.pathname==='/api/skins/promos/admin')return json({codes});
      if(url.pathname.endsWith('/admin/issue')){
        const body=route.request().postDataJSON();writes.push(body);
        if(!codes.length)codes.push({id:'hash-only',presetId:body.presetId,reason:body.reason,expiresAt:body.expiresAt,redeemedAt:null,revokedAt:null});
        if(failIssue){failIssue=false;return json({error:'Fixture acknowledgement lost'},503);}return json({duplicate:true,id:'hash-only'});
      }
      if(url.pathname.endsWith('/admin/revoke')){codes[0].revokedAt=Date.now();return json({duplicate:false});}
      if(url.pathname.endsWith('/redeem')){if(failRedeem){failRedeem=false;return json({error:'Fixture redemption unavailable'},503);}return json({duplicate:false,presetId:'mine'});}
      const root=path.join(__dirname,'../public'),file=path.join(root,url.pathname==='/skin-codes'?'skin-codes.html':url.pathname.slice(1));
      if(!file.startsWith(root)||!fs.existsSync(file))return route.abort();
      return route.fulfill({contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript',body:fs.readFileSync(file)});
    });
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
    await page.goto('http://localhost/skin-codes');await page.waitForFunction(()=>!document.querySelector('#promo-issue button').disabled);
    assert.equal(await page.locator('#promo-issue select[name=presetId] option').count(),2);
    await page.selectOption('[name=presetId]','mine');await page.fill('#promo-issue textarea','Event winner <img src=x onerror=alert(1)>');
    await page.click('#promo-issue button');await page.getByText('Fixture acknowledgement lost',{exact:true}).waitFor();
    const secret=await page.inputValue('#promo-code');assert.match(secret,/^HVP-[a-f0-9]{64}$/);
    assert.equal(await page.locator('#promo-issue textarea').isDisabled(),true);
    await page.getByRole('button',{name:'Retry this code'}).click();await page.getByText('Promotional code created.',{exact:true}).waitFor();
    assert.deepEqual(writes[0],writes[1]);assert.equal(await page.inputValue('#promo-code'),secret);
    assert.equal(await page.locator('#promo-history img').count(),0);
    assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
    await page.fill('#promo-history textarea','Event cancelled before claiming');await page.getByRole('button',{name:'Revoke code',exact:true}).click();await page.getByText(/^Revoked ·/).waitFor();
    await page.fill('#promo-redeem input',secret);await page.click('#promo-redeem button');await page.getByText('Fixture redemption unavailable',{exact:true}).waitFor();
    assert.equal(await page.inputValue('#promo-redeem input'),secret);await page.click('#promo-redeem button');await page.getByText('Skin unlocked. Open My Skins in Skin Studio to find it.',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.click('#promo-new');readOnly=true;await page.reload();await page.getByText('This preview is read-only. Code changes and redemption are disabled.',{exact:true}).waitFor();
    assert.equal(await page.locator('#promo-redeem button').isDisabled(),true);assert.equal(await page.locator('#promo-issue button').isDisabled(),true);
    role='guest';await page.reload();await page.locator('#promo-signin').waitFor({state:'visible'});assert.equal(await page.locator('#promo-admin').isVisible(),false);
    enabled=false;await page.reload();await page.getByText('Promotional skin codes are not open yet.',{exact:true}).waitFor();assert.equal(await page.locator('#promo-redeem').isVisible(),false);
    assert.deepEqual(errors,[]);console.log(`PASS ${width}px: issuance retry, secret retention, safe history, revocation, redemption retry, preview, guest, disabled state and layout`);await context.close();
  }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
