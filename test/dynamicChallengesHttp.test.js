"use strict";
const test=require('node:test'), assert=require('node:assert/strict'), express=require('express');
const {DatabaseSync}=require('node:sqlite'),{randomBytes,randomUUID}=require('node:crypto');
const A='76561198000000801',B='76561198000000802';
const listen=app=>new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve({server,url:`http://127.0.0.1:${server.address().port}`}));});
test('challenge API binds Steam identity, protects consent and never accepts client progress',async()=>{
  const keys=['DYNAMIC_CHALLENGES_ENABLED','DYNAMIC_CHALLENGES_READ_ONLY','VALLEY_LEGACY_ENABLED','HOLLOW_VALLEY_API_TOKEN','AUTOMATION_SERVICE_URL','SKIN_STUDIO_READ_ONLY','RENDER_SERVICE_ID','RENDER_EXTERNAL_URL','PUBLIC_SITE_URL','STEAM_REALM','STEAM_RETURN_URL'];
  const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));for(const k of keys)delete process.env[k];
  process.env.DYNAMIC_CHALLENGES_ENABLED='1';process.env.VALLEY_LEGACY_ENABLED='1';process.env.HOLLOW_VALLEY_API_TOKEN=randomBytes(32).toString('hex');
  let clock=Date.parse('2026-11-05T00:00:00+10:00');const db=new DatabaseSync(':memory:');
  const store=require('../automation-platform/src/services/valleyLegacyStore').createLegacyStore(db,{now:()=>clock});
  const legacy=require('../automation-platform/src/services/valleyLegacyService'),get=legacy.get;legacy.get=()=>store;
  let backend,website;
  try {
    const internal=express();internal.use(express.json());internal.use('/api/website/legacy',require('../automation-platform/src/routes/valleyLegacyRoutes'));backend=await listen(internal);
    process.env.AUTOMATION_SERVICE_URL=backend.url;
    const app=express();app.use(express.json());app.use((req,_res,next)=>{if(req.get('x-user'))req.user={steam_id:req.get('x-user')};next();});app.use('/challenges',require('../server/routes/dynamicChallenges'));website=await listen(app);
    const request=(path,{body,user=A,origin=website.url,headers={}}={})=>fetch(website.url+'/challenges'+path,{
      method:body===undefined?'GET':'POST',headers:{'x-user':user,Origin:origin,'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const direct=(path,body,token=process.env.HOLLOW_VALLEY_API_TOKEN)=>fetch(backend.url+'/api/website/legacy/challenges/'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});
    const choice=(selected,revision)=>({selected,expectedRevision:revision,requestKey:randomUUID()});
    const caps=await request('/capabilities',{user:''});assert.deepEqual(await caps.json(),{enabled:true,readOnly:false,rewardsEnabled:false});
    assert.equal((await request('/me',{user:''})).status,401);assert.equal((await request('/me',{user:'bad'})).status,403);
    assert.equal((await direct('status',{steamId:A},'bad')).status,401);
    const initial=await request('/me');assert.equal(initial.headers.get('cache-control'),'private, no-store');assert.equal((await initial.json()).revision,0);
    const enroll=choice(true,0);
    assert.equal((await request('/participation',{body:enroll,origin:'https://evil.invalid'})).status,403);
    assert.equal((await request('/participation',{body:enroll,origin:''})).status,403);
    assert.equal((await request('/participation',{body:enroll,headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
    assert.equal((await request('/participation',{body:enroll,headers:{'Content-Type':'text/plain'}})).status,403);
    const accepted=await request('/participation',{body:{...enroll,steamId:B,progress:999,completed:true}});assert.equal(accepted.status,200);assert.equal((await accepted.json()).revision,1);
    assert.equal(store.challenges.status(B).participating,false);assert.equal(store.challenges.status(A).challenges[1].progress,0);
    clock+=60000;store.snapshot([{steamId:A,species:'rex',growth:0.5}],clock);
    const mine=await (await request('/me?steamId='+B)).json();assert.equal(mine.challenges[1].progress,1);
    const other=await (await request('/me',{user:B})).json();assert.equal(other.challenges[1].progress,0);
    assert.equal(JSON.stringify(mine).includes(A),false);assert.equal(JSON.stringify(mine).includes('life_id'),false);
    const duplicate=await (await request('/participation',{body:enroll})).json();assert.equal(duplicate.duplicate,true);assert.equal(duplicate.revision,1);
    assert.equal((await request('/participation',{body:{...enroll,selected:false}})).status,409);
    const races=await Promise.all([request('/participation',{body:choice(false,1)}),request('/participation',{body:choice(false,1)})]);
    assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);assert.equal(store.challenges.status(A).revision,2);
    assert.equal(store.challenges.status(A).participating,false);assert.equal(store.challenges.status(A).challenges[1].progress,0);
    assert.equal((await (await request('/participation',{body:enroll})).json()).participating,false);
    for(const body of [choice('true',2),choice(true,'2'),{selected:true,expectedRevision:2},choice(true,-1)])assert.equal((await request('/participation',{body})).status,400);
    process.env.DYNAMIC_CHALLENGES_READ_ONLY='1';assert.equal((await request('/participation',{body:choice(true,2)})).status,403);
    assert.equal((await direct('change',{steamId:A,...choice(true,2)})).status,403);assert.equal((await request('/me')).status,200);
    delete process.env.DYNAMIC_CHALLENGES_READ_ONLY;process.env.RENDER_SERVICE_ID='preview-service';
    assert.equal((await (await request('/capabilities')).json()).readOnly,true);assert.equal((await request('/participation',{body:choice(true,2)})).status,403);delete process.env.RENDER_SERVICE_ID;
    // A website token has no route for writing challenge evidence or awards.
    assert.equal((await direct('evidence',{steamId:A,progress:999})).status,404);
    process.env.DYNAMIC_CHALLENGES_ENABLED='0';assert.equal((await request('/me')).status,503);assert.equal((await direct('status',{steamId:A})).status,503);
    assert.equal((await (await request('/capabilities',{user:''})).json()).enabled,false);
  } finally {
    for(const surface of [website,backend])if(surface)await new Promise(resolve=>surface.server.close(resolve));
    legacy.get=get;db.close();for(const [k,v] of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;
  }
});
