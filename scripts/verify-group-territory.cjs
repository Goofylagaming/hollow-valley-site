const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.HV_TEST_BROWSER});
  try{for(const width of [1440,390]){
    const context=await browser.newContext({viewport:{width,height:1000}});
    let member=true,owner=true,readOnly=false,mismatch=false,hold=false,release,held;
    let state={groupId:4,territoryGroupId:null,revision:0,active:false,choices:[{id:10,name:'Clan <img src=x>'}]};
    const writes=[],errors=[];
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());if(url.origin!=='http://localhost')return route.abort();
      const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
      if(url.pathname==='/assets/common.js')return route.fulfill({contentType:'text/javascript',body:`window.HDS={api:async(u,o={})=>{const r=await fetch(u,o);const b=await r.json();if(!r.ok)throw new Error(b.error);return b;},loadMe:async()=>({user:{steam_id:'76561198000000001'}})};`});
      if(url.pathname.endsWith('/capabilities'))return json({enabled:true,readOnly});
      if(url.pathname==='/api/group-headquarters/territory-link'){
        if(!member)return json({error:'Membership required'},404);
        if(route.request().method()==='POST'){
          const body=route.request().postDataJSON();writes.push(body);
          state={...state,territoryGroupId:body.territoryGroupId,revision:state.revision+1,active:body.territoryGroupId!==null};
        }
        const snapshot={...state,canEdit:owner};
        if(hold){held=true;await new Promise(resolve=>{release=resolve;});}
        return json(snapshot);
      }
      if(url.pathname==='/api/group-headquarters/battles')return member?json({groupId:mismatch?99:state.groupId,battles:[{attackId:21,eventId:3,side:'defender',result:'win',resolvedAt:1793850000000}]}):json({error:'Membership required'},404);
      if(url.pathname.endsWith('.js')&&!url.pathname.includes('group-territory'))return route.fulfill({contentType:'text/javascript',body:''});
      const file=path.join(__dirname,'../public',url.pathname==='/groups'?'groups.html':url.pathname.slice(1));
      if(!fs.existsSync(file))return route.abort();return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript'});
    });
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    const reveal=()=>page.evaluate(()=>{for(const el of document.querySelectorAll('[hidden]'))if(el.contains(document.getElementById('hq-territory')))el.hidden=false;});
    await page.goto('http://localhost/groups');await reveal();
    await page.getByText('No Territory Wars group linked.',{exact:true}).waitFor();
    await page.selectOption('#hq-territory-choice','10');await page.click('#hq-territory-save');
    await page.getByText('Linked Territory Wars group #10.',{exact:true}).waitFor();
    assert.deepEqual(writes[0],{territoryGroupId:10,expectedRevision:0,expectedGroupId:4});
    assert.ok((await page.locator('#hq-battles').textContent()).includes('Defending · Win'));
    assert.equal(await page.locator('#hq-territory img').count(),0);
    await page.selectOption('#hq-territory-choice','');await page.click('#hq-territory-save');
    await page.getByText('No Territory Wars group linked.',{exact:true}).waitFor();assert.equal(writes[1].expectedRevision,1);
    owner=false;await page.click('#hq-territory-refresh');await page.waitForFunction(()=>document.getElementById('hq-territory-form').hidden);
    owner=true;readOnly=true;await page.reload();await reveal();await page.getByText('This preview is read-only.',{exact:true}).waitFor();
    assert.equal(await page.locator('#hq-territory-save').isDisabled(),true);
    mismatch=true;await page.click('#hq-territory-refresh');await page.getByText('Group membership changed. Refresh Territory records.',{exact:true}).waitFor();
    assert.equal(await page.locator('#hq-battles li').count(),0);
    mismatch=false;hold=true;held=false;await page.click('#hq-territory-refresh');
    while(!held)await new Promise(resolve=>setTimeout(resolve,10));
    member=false;await page.evaluate(()=>window.dispatchEvent(new CustomEvent('hv:group-state',{detail:{groupId:null}})));
    hold=false;release();await page.waitForTimeout(100);
    assert.equal(await page.locator('#hq-battles li').count(),0);assert.equal(await page.locator('#hq-territory-current').textContent(),'');
    assert.equal(await page.locator('#hq-territory-save').isDisabled(),true);
    assert.deepEqual(errors,[]);console.log(`PASS ${width}px linking, unlinking, battle results, safe text, member/preview controls and stale-response rejection`);
    await context.close();
  }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
