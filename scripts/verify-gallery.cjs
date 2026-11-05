const {chromium}=require('playwright');
const express=require('express');
const sharp=require('sharp');
const path=require('node:path');
const fs=require('node:fs');
const assert=require('node:assert/strict');
process.env.DB_PATH=':memory:';process.env.HV_GALLERY_ENABLED='1';
const {db}=require('../server/db');
(async()=>{
  const app=express();
  app.use((req,res,next)=>{const role=req.get('x-fixture-role');if(role)req.user={steam_id:role==='admin'?'76561198000000552':'76561198000000551',username:'Fixture photographer',is_admin:role==='admin'};next();});
  app.get('/api/me',(req,res)=>res.json({user:req.user||null}));
  app.get('/assets/common.js',(_req,res)=>res.type('js').send(`window.HDS={api:async(url,options={})=>{const r=await fetch(url,{headers:{'Content-Type':'application/json'},...options});const b=await r.json();if(!r.ok)throw new Error(b.error);return b;},loadMe:()=>window.HDS.api('/api/me')};`));
  app.use('/api/gallery',require('../server/routes/gallery'));
  app.get('/gallery',(_req,res)=>res.sendFile(path.join(__dirname,'../public/gallery.html')));
  app.use(express.static(path.join(__dirname,'../public')));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({headless:true,executablePath:process.env.HV_TEST_BROWSER});
  const image=await sharp({create:{width:480,height:240,channels:3,background:'#20764b'}}).png().toBuffer();
  try{for(const width of [1440,390]){
    const context=await browser.newContext({viewport:{width,height:1000},extraHTTPHeaders:{'x-fixture-role':'owner'}});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    let fail=true;const ids=[];
    await page.route('**/api/gallery?title=*',async route=>{
      ids.push(route.request().headers()['x-upload-id']);
      const result=await route.fetch();
      if(fail){fail=false;return route.fulfill({status:502,contentType:'application/json',body:JSON.stringify({error:'Fixture lost acknowledgement; retry'})});}
      return route.fulfill({response:result});
    });
    await page.goto(base+'/gallery?view=mine');await page.waitForFunction(()=>!document.getElementById('gallery-upload').hidden);
    assert.equal(await page.locator('[data-view=admin]').isVisible(),false);
    await page.fill('[name=title]',`Valley screenshot ${width} <img src=x>`);
    await page.setInputFiles('[name=image]',{name:'screenshot.png',mimeType:'image/png',buffer:image});
    await page.click('#gallery-upload button');await page.waitForFunction(()=>document.getElementById('gallery-message').textContent.includes('lost acknowledgement'));
    assert.ok((await page.inputValue('[name=title]')).includes('Valley screenshot'));
    await page.click('#gallery-upload button');await page.waitForFunction(()=>document.getElementById('gallery-message').textContent.includes('submitted'));
    assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);
    assert.equal(await page.locator('.gallery-card').count(),width===1440?1:2); // withdrawn history remains visible to owner
    assert.equal(await page.locator('.gallery-card h2 img').count(),0);
    const admin=await browser.newContext({viewport:{width,height:1000},extraHTTPHeaders:{'x-fixture-role':'admin'}});
    const review=await admin.newPage();review.on('pageerror',e=>errors.push(e.message));
    await review.goto(base+'/gallery');await review.locator('[data-view=admin]').waitFor({state:'visible'});await review.click('[data-view=admin]');
    await review.locator('.gallery-review textarea').first().fill('Reviewed community screenshot');
    await review.locator('.gallery-review input[type=checkbox]').first().check();
    await review.locator('.gallery-review button').first().click();await review.waitForFunction(()=>document.getElementById('gallery-message').textContent==='Decision recorded.');
    await review.getByRole('button',{name:'View decision history'}).first().click();await review.getByText(/approved: Reviewed community screenshot/).waitFor();
    await review.selectOption('#gallery-status','pending');await review.getByText('No screenshots in this view yet.').waitFor();
    await review.selectOption('#gallery-status','approved');await review.getByText('Featured screenshot').waitFor();
    await page.click('[data-view=featured]');await page.getByText('Featured screenshot').waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(process.env.HV_TEST_OUTPUT){fs.mkdirSync(process.env.HV_TEST_OUTPUT,{recursive:true});await page.screenshot({path:path.join(process.env.HV_TEST_OUTPUT,`gallery-${width}.png`),fullPage:true});}
    const guest=await browser.newContext({viewport:{width,height:1000}}),guestPage=await guest.newPage();await guestPage.goto(base+'/gallery');await guestPage.getByText('Featured screenshot').waitFor();
    assert.equal(await guestPage.locator('[data-view=mine]').isVisible(),false);assert.equal(await guestPage.locator('#gallery-signin').isVisible(),true);
    await page.click('[data-view=mine]');page.on('dialog',dialog=>dialog.accept());
    await page.getByRole('button',{name:'Remove my screenshot'}).click();await page.waitForFunction(()=>document.getElementById('gallery-message').textContent==='Screenshot removed.');
    await guestPage.click('#gallery-refresh');await guestPage.getByText('No screenshots in this view yet.').waitFor();
    process.env.HV_GALLERY_ENABLED='0';await page.click('#gallery-refresh');await page.getByText('The gallery is not open yet. Check back after launch.').waitFor();
    assert.equal(await page.locator('#gallery-upload').isVisible(),false);process.env.HV_GALLERY_ENABLED='1';
    assert.deepEqual(errors,[]);console.log(`PASS ${width}px: real upload/retry, moderation/history/filters, featured display, withdrawal, guest, disabled rollout and layout`);
    await guest.close();await admin.close();await context.close();
  }}finally{await browser.close();await new Promise(resolve=>server.close(resolve));db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
