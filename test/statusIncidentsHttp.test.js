"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),{DatabaseSync}=require('node:sqlite'),{randomUUID}=require('node:crypto');
test('incident routes separate public reports from current staff proof and enforce default-off, origin, preview and paused withdrawal controls',async()=>{
 const keys=['STATUS_INCIDENTS_ENABLED','STATUS_INCIDENTS_MANAGEMENT_ENABLED','STATUS_INCIDENTS_PUBLIC_ENABLED','STATUS_INCIDENTS_READ_ONLY','STATUS_INCIDENTS_EVIDENCE_GUILD_ID','SKIN_STUDIO_READ_ONLY','RENDER_SERVICE_ID','RENDER_EXTERNAL_URL','PUBLIC_SITE_URL','STEAM_REALM','STEAM_RETURN_URL'],saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));keys.forEach(k=>delete process.env[k]);
 const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,steam_id TEXT,is_admin INTEGER);INSERT INTO users VALUES(1,'76561198000000001',1),(2,'76561198000000002',0)");const app=express();app.use(express.json());app.use((req,_res,next)=>{const id=Number(req.get('x-fixture-user'));if(id)req.user=db.prepare('SELECT * FROM users WHERE id=?').get(id);next();});
 const {publicRouter,adminRouter}=require('../server/routes/statusIncidents').createRouters({db});app.use('/api/status-incidents',publicRouter);app.use('/api/admin/status-incidents',adminRouter);
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base='http://127.0.0.1:'+server.address().port;
 const call=(route,body,headers={})=>fetch(base+route,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json',origin:base}:{}),...headers},body:body?JSON.stringify(body):undefined});
 try{
  assert.equal((await (await call('/api/status-incidents/capabilities')).json()).available,false);assert.equal((await call('/api/status-incidents')).status,503);
  assert.equal((await call('/api/admin/status-incidents/capabilities')).status,401);assert.equal((await call('/api/admin/status-incidents/capabilities',null,{'x-fixture-user':'2'})).status,403);
  const staff={'x-fixture-user':'1','x-status-reviewer':'1:76561198000000001'};assert.equal((await (await call('/api/admin/status-incidents/capabilities',null,staff)).json()).enabled,false);
  process.env.STATUS_INCIDENTS_ENABLED='1';process.env.STATUS_INCIDENTS_PUBLIC_ENABLED='1';process.env.STATUS_INCIDENTS_EVIDENCE_GUILD_ID='111122223333444455';
  const id=randomUUID(),route='/api/admin/status-incidents/'+id,now=Date.now(),body={action:'save',expectedRevision:0,requestKey:randomUUID(),reason:'Reviewed source evidence',details:{components:['website'],severity:'degraded',status:'investigating',title:'Website interruption',summary:'Staff are checking reports of interrupted page loads.',startedAt:now-60000,endedAt:null,verifiedAt:now-1000,evidenceUrls:['https://discord.com/channels/111122223333444455/222233334444555566/333344445555666677'],evidenceNote:'Private staff proof and account 76561198000000002.'}};
  assert.equal((await call(route,body,{...staff,origin:'https://elsewhere.invalid'})).status,403);assert.equal((await call(route,body,{...staff,'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal((await call(route,body,{...staff,'x-status-reviewer':'2:76561198000000002'})).status,403);assert.equal((await call(route,body,{'x-fixture-user':'1'})).status,403);
  process.env.STATUS_INCIDENTS_READ_ONLY='1';assert.equal((await call(route,body,staff)).status,403);delete process.env.STATUS_INCIDENTS_READ_ONLY;
  const draft=await (await call(route,body,staff)).json();assert.equal(draft.current.revision,1);assert.equal((await (await call('/api/status-incidents')).json()).items.length,0);
  const publish={action:'publish',expectedRevision:1,requestKey:randomUUID(),reason:'Reviewed public wording',reviewDigest:draft.current.reviewDigest};assert.equal((await call(route,publish,staff)).status,200);assert.equal((await (await call(route,publish,staff)).json()).duplicate,true);
  const response=await call('/api/status-incidents'),publicBody=await response.json();assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(publicBody.items.length,1);assert.doesNotMatch(JSON.stringify(publicBody),/76561198|Private staff|discord\.com|evidence/);
  assert.equal((await call(route)).status,401);assert.equal((await call('/api/status-incidents?before=NaN')).status,400);
  process.env.STATUS_INCIDENTS_ENABLED='0';process.env.STATUS_INCIDENTS_MANAGEMENT_ENABLED='1';assert.equal((await call('/api/status-incidents')).status,200);
  const withdraw={action:'withdraw',expectedRevision:2,requestKey:randomUUID(),reason:'Withdrawing the public report'};assert.equal((await call(route,withdraw,staff)).status,200);assert.equal((await (await call('/api/status-incidents')).json()).items.length,0);
  db.exec('UPDATE users SET is_admin=0 WHERE id=1');assert.equal((await call(route,null,staff)).status,403);
 }finally{await new Promise(resolve=>server.close(resolve));db.close();for(const [k,v]of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
