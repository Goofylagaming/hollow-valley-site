const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({headless:true,executablePath:process.env.HV_TEST_BROWSER});
  try { for (const width of [1440,390]) {
    const context = await browser.newContext({viewport:{width,height:1000}});
    let readOnly=false, owner=true, member=true;
    let profile={name:'Valley <img src=x>',description:'Explorers',revision:0,edits:[],members:[{steamId:'76561198000000002',name:'Member <img src=x>',role:'member',rank:'member',rankRevision:0}],rankEdits:[],screenshots:[],screenshotChoices:[{id:'fixture-image',title:'Picture <img src=x>'}]};const writes=[],rankWrites=[];
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());if(url.origin!=='http://localhost')return route.abort();
      const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
      if(url.pathname==='/assets/common.js')return route.fulfill({contentType:'text/javascript',body:`window.HDS={api:async(u,o={})=>{const r=await fetch(u,o);const b=await r.json();if(!r.ok)throw new Error(b.error);return b;},loadMe:async()=>({user:{steam_id:'76561198000000001'}})};`});
      if(url.pathname.endsWith('/capabilities'))return json({enabled:true,readOnly});
      if(url.pathname==='/api/group-headquarters/screenshots'){
        const body=route.request().postDataJSON();profile.screenshots=body.remove?[]:[{id:body.imageId,title:'Picture <img src=x>',author:'Member',available:true,canRemove:true}];
        profile.screenshotChoices=body.remove?[{id:'fixture-image',title:'Picture <img src=x>'}]:[];
        return json({...profile,canEdit:owner});
      }
      if(url.pathname==='/api/group-headquarters/ranks'){
        const body=route.request().postDataJSON();rankWrites.push(body);
        profile.members[0].rank=body.rank;profile.members[0].rankRevision++;
        profile.rankEdits=[{memberName:profile.members[0].name,rank:body.rank,createdAt:'2026-11-05'}];
        return json({...profile,canEdit:owner});
      }
      if(url.pathname==='/api/group-headquarters'){
        if(!member)return json({error:'An active group membership is required'},404);
        if(route.request().method()==='POST'){
          const body=route.request().postDataJSON();writes.push(body);
          profile={...profile,description:body.description,emblem:body.emblem,revision:profile.revision+1,edits:[{revision:profile.revision+1,description:body.description,createdAt:'2026-11-05'}]};
        }
        return json({...profile,canEdit:owner});
      }
      if(url.pathname.endsWith('.js')&&!url.pathname.includes('group-headquarters'))return route.fulfill({contentType:'text/javascript',body:''});
      const file=path.join(__dirname,'../public',url.pathname==='/groups'?'groups.html':url.pathname.slice(1));
      if(!fs.existsSync(file))return route.abort();return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript'});
    });
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://localhost/groups');
    await page.evaluate(()=>{document.querySelectorAll('[hidden]').forEach(el=>{if(el.contains(document.getElementById('group-headquarters')))el.hidden=false;});});
    await page.getByText('You can edit your group description.',{exact:true}).waitFor();
    assert.equal(await page.locator('#group-headquarters img').count(),0);
    await page.fill('#hq-description','Our group <img src=x>');await page.selectOption('#hq-emblem-choice','sun');await page.click('#hq-save');
    await page.waitForFunction(()=>document.getElementById('hq-current').textContent==='Our group <img src=x>');
    assert.deepEqual(writes[0],{description:'Our group <img src=x>',emblem:'sun',expectedRevision:0});assert.equal(await page.locator('#hq-history li').count(),1);
    await page.locator('#hq-ranks select').selectOption('veteran');await page.getByRole('button',{name:'Save rank',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('hq-ranks').textContent.includes('· veteran'));
    assert.deepEqual(rankWrites[0],{memberSteamId:'76561198000000002',rank:'veteran',expectedRevision:0});
    assert.equal(await page.locator('#hq-ranks img').count(),0);assert.equal(await page.locator('#hq-rank-history img').count(),0);
    await page.click('#hq-share');await page.locator('#hq-screenshots figure').waitFor();
    assert.equal(await page.locator('#hq-screenshots img').count(),1);
    assert.ok((await page.locator('#hq-screenshots img').getAttribute('src')).startsWith('/api/gallery/fixture-image/image'));
    await page.getByRole('button',{name:'Remove screenshot',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#hq-screenshots figure'));
    owner=false;await page.click('#hq-refresh');await page.getByText('The group owner can edit this description.',{exact:true}).waitFor();assert.equal(await page.locator('#hq-editor').isVisible(),false);
    owner=true;readOnly=true;await page.reload();await page.evaluate(()=>{document.querySelectorAll('[hidden]').forEach(el=>{if(el.contains(document.getElementById('group-headquarters')))el.hidden=false;});});await page.getByText('This preview is read-only.',{exact:true}).waitFor();assert.equal(await page.locator('#hq-save').isDisabled(),true);
    member=false;await page.click('#hq-refresh');await page.getByText('An active group membership is required',{exact:true}).waitFor();assert.equal(await page.locator('#hq-history li').count(),0);
    assert.equal(await page.locator('#hq-ranks select').count(),0);assert.equal(await page.locator('#hq-rank-history li').count(),0);
    assert.deepEqual(errors,[]);console.log(`PASS ${width}px owner editing, member view, safe text, history, preview and membership loss`);await context.close();
  }} finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
