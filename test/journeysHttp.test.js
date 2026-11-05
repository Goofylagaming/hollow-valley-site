const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {DatabaseSync}=require('node:sqlite'),{randomBytes}=require('node:crypto');
const steam='76561198000000801',other='76561198000000802';
const listen=app=>new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve({server,url:`http://127.0.0.1:${server.address().port}`}));});
test('journey HTTP flow binds session identity, requires private consent and protects deletion',async()=>{
  const keys=['JOURNEY_HISTORY_ENABLED','JOURNEY_HISTORY_READ_ONLY','VALLEY_LEGACY_ENABLED','HOLLOW_VALLEY_API_TOKEN','AUTOMATION_SERVICE_URL','SKIN_STUDIO_READ_ONLY','RENDER_SERVICE_ID','RENDER_EXTERNAL_URL','PUBLIC_SITE_URL','STEAM_REALM','STEAM_RETURN_URL'];
  const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));for(const k of keys)delete process.env[k];
  process.env.JOURNEY_HISTORY_ENABLED='1';process.env.VALLEY_LEGACY_ENABLED='1';process.env.HOLLOW_VALLEY_API_TOKEN=randomBytes(32).toString('hex');
  const db=new DatabaseSync(':memory:');let clock=1000000;
  const journeys=require('../automation-platform/src/services/journeyStore').createJourneyStore(db,{now:()=>clock});
  const legacy=require('../automation-platform/src/services/valleyLegacyService'),get=legacy.get;legacy.get=()=>({journeys});
  let backend,website;
  try {
    const internal=express();internal.use(express.json());internal.use('/api/website/legacy/journeys',require('../automation-platform/src/routes/journeyRoutes'));backend=await listen(internal);
    process.env.AUTOMATION_SERVICE_URL=backend.url;
    const app=express();app.use(express.json());app.use((req,_res,next)=>{if(req.get('x-user'))req.user={steam_id:req.get('x-user')};next();});app.use('/journeys',require('../server/routes/journeys'));website=await listen(app);
    const request=(path,{body,user=steam,origin=website.url}={})=>fetch(website.url+'/journeys'+path,{method:body===undefined?'GET':'POST',headers:{'x-user':user,Origin:origin,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
    assert.equal((await request('/settings',{user:''})).status,401);
    assert.equal((await request('/settings',{user:'bad'})).status,403);
    assert.equal((await fetch(backend.url+'/api/website/legacy/journeys/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({steamId:steam})})).status,401);
    const read=await request('/settings');assert.equal(read.headers.get('cache-control'),'private, no-store');assert.deepEqual(await read.json(),{enabled:false,revision:0});
    assert.equal((await request('/settings',{body:{enabled:true,expectedRevision:0},origin:'https://other.invalid'})).status,403);
    assert.equal((await request('/settings',{body:{enabled:true,expectedRevision:0,steamId:other}})).status,200);
    assert.equal(journeys.settings(steam).enabled,true);assert.equal(journeys.settings(other).enabled,false);
    clock+=15000;journeys.record({steamId:steam,lifeId:'life',at:clock,location:{x:10,y:20}});
    assert.equal((await (await request('/points?steamId='+other)).json()).points.length,1);
    assert.equal((await (await request('/points',{user:other})).json()).points.length,0);
    assert.equal((await request('/points?before=invalid')).status,400);
    process.env.JOURNEY_HISTORY_READ_ONLY='1';assert.equal((await request('/delete',{body:{expectedRevision:1}})).status,403);
    assert.equal((await request('/points')).status,200);delete process.env.JOURNEY_HISTORY_READ_ONLY;
    assert.equal((await request('/delete',{body:{expectedRevision:0}})).status,409);
    assert.equal((await request('/delete',{body:{expectedRevision:1,steamId:other}})).status,200);
    assert.deepEqual(journeys.settings(steam),{enabled:false,revision:2});assert.equal(journeys.points(steam).points.length,0);
    process.env.JOURNEY_HISTORY_ENABLED='0';assert.equal((await request('/points')).status,503);
  } finally {
    for(const surface of [website,backend])if(surface)await new Promise(resolve=>surface.server.close(resolve));
    legacy.get=get;db.close();for(const [k,v] of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;
  }
});
