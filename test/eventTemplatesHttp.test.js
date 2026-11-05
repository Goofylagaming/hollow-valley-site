"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),{DatabaseSync}=require('node:sqlite'),{randomUUID}=require('node:crypto');
test('template HTTP routes require current staff, exact-origin JSON and explicit enabled writable deployment',async()=>{
 const names=['EVENT_ENGINE_ENABLED','EVENT_ENGINE_READ_ONLY','SKIN_STUDIO_READ_ONLY','RENDER_SERVICE_ID','RENDER_EXTERNAL_URL','PUBLIC_SITE_URL','STEAM_REALM','STEAM_RETURN_URL'],saved=Object.fromEntries(names.map(k=>[k,process.env[k]]));for(const k of names)delete process.env[k];
 const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,steam_id TEXT,is_admin INTEGER);INSERT INTO users VALUES(1,'76561198000000001',1),(2,'76561198000000002',0)");
 const app=express();app.use(express.json());app.use((req,_res,next)=>{if(req.get('x-user'))req.user={id:Number(req.get('x-user')),steam_id:'7656119800000000'+req.get('x-user')};next();});app.use('/templates',require('../server/routes/eventTemplates').createRouter({db}));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const base='http://127.0.0.1:'+server.address().port;
 const request=(path,{body,user='1',origin=base,headers={}}={})=>fetch(base+'/templates'+path,{method:body?'POST':'GET',headers:{'x-user':user,Origin:origin,'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});
 const id=randomUUID(),body={expectedRevision:0,requestKey:randomUUID(),action:'save',details:{kind:'migration',title:'Valley Migration',description:'Follow the reviewed staff route.',rules:'Wait for staff before moving to the next stop.',durationMinutes:90,capacity:50,teamCount:1}};
 try{
  assert.equal((await request('/capabilities',{user:''})).status,401);assert.equal((await request('/capabilities',{user:'2'})).status,403);
  assert.equal((await (await request('/capabilities')).json()).enabled,false);assert.equal((await request('/')).status,503);assert.equal((await request('/'+id,{body})).status,503);
  process.env.EVENT_ENGINE_ENABLED='1';const capabilities=await request('/capabilities');assert.equal(capabilities.headers.get('cache-control'),'private, no-store');assert.equal((await capabilities.json()).executionEnabled,false);
  for(const options of [{origin:'https://evil.invalid'},{origin:''},{headers:{'Sec-Fetch-Site':'cross-site'}},{headers:{'Content-Type':'text/plain'}}])assert.equal((await request('/'+id,{body,...options})).status,403);
  assert.equal((await request('/'+id,{body:{...body,actorSteamId:'76561198000000002'}})).status,400);
  assert.equal((await request('/'+id,{body})).status,200);assert.equal((await (await request('/'+id,{body})).json()).duplicate,true);
  assert.equal((await request('/?before=bad')).status,400);assert.equal((await request('/'+id+'/history')).status,200);
  process.env.EVENT_ENGINE_READ_ONLY='1';assert.equal((await request('/'+id,{body})).status,403);assert.equal((await request('/'+id)).status,200);delete process.env.EVENT_ENGINE_READ_ONLY;
  process.env.RENDER_SERVICE_ID='preview-service';assert.equal((await (await request('/capabilities')).json()).readOnly,true);assert.equal((await request('/'+id,{body})).status,403);delete process.env.RENDER_SERVICE_ID;
  db.exec('UPDATE users SET is_admin=0 WHERE id=1');for(const path of ['/','/'+id,'/'+id+'/history'])assert.equal((await request(path)).status,403);assert.equal((await request('/'+id,{body})).status,403);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();for(const [k,v]of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
