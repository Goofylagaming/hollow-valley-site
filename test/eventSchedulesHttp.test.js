"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),{DatabaseSync}=require('node:sqlite'),{randomUUID}=require('node:crypto');
test('schedule API protects staff drafts and mutations while public calendar exposes only explicitly scheduled plans',async()=>{
 const names=['EVENT_ENGINE_ENABLED','EVENT_ENGINE_SCHEDULES_ENABLED','EVENT_ENGINE_READ_ONLY','SKIN_STUDIO_READ_ONLY','RENDER_SERVICE_ID','RENDER_EXTERNAL_URL','PUBLIC_SITE_URL','STEAM_REALM','STEAM_RETURN_URL'],saved=Object.fromEntries(names.map(k=>[k,process.env[k]]));for(const k of names)delete process.env[k];
 const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,steam_id TEXT,is_admin INTEGER);INSERT INTO users VALUES(1,'76561198000000001',1),(2,'76561198000000002',0)");const user={id:1,steam_id:'76561198000000001'},templates=require('../server/services/eventTemplateStore').createEventTemplateStore(db);
 const template=templates.change(user,{id:randomUUID(),expectedRevision:0,requestKey:randomUUID(),action:'save',details:{kind:'fight-night',title:'Website Fight Night',description:'Planned community event with staff.',rules:'Follow the reviewed staff event rules.',durationMinutes:60,capacity:16,teamCount:2}}).current;
 const app=express();app.use(express.json());app.use((req,_res,next)=>{if(req.get('x-user'))req.user={id:Number(req.get('x-user')),steam_id:'7656119800000000'+req.get('x-user')};next();});app.use('/schedules',require('../server/routes/eventSchedules').createRouter({db}));const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));}),base='http://127.0.0.1:'+server.address().port;
 const request=(path,{body,user='1',origin=base,headers={}}={})=>fetch(base+'/schedules'+path,{method:body?'POST':'GET',headers:{'x-user':user,Origin:origin,'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})}),id=randomUUID();
 const create={action:'create',expectedRevision:0,requestKey:randomUUID(),templateId:template.id,templateRevision:1,startsAt:Date.now()+86400000},publish={action:'publish',expectedRevision:1,requestKey:randomUUID(),reason:'Staff reviewed the schedule and frozen rules.'};
 try{
  assert.equal((await (await request('/public',{user:''})).json()).enabled,false);assert.equal((await request('/')).status,503);
  process.env.EVENT_ENGINE_ENABLED='1';assert.equal((await request('/'+id,{body:create})).status,503);process.env.EVENT_ENGINE_SCHEDULES_ENABLED='1';
  assert.equal((await request('/',{user:''})).status,401);assert.equal((await request('/',{user:'2'})).status,403);
  for(const options of [{origin:'https://evil.invalid'},{origin:''},{headers:{'Sec-Fetch-Site':'cross-site'}},{headers:{'Content-Type':'text/plain'}}])assert.equal((await request('/'+id,{body:create,...options})).status,403);
  assert.equal((await request('/'+id,{body:{...create,eventId:id}})).status,400);assert.equal((await request('/'+id,{body:create})).status,200);assert.equal((await (await request('/public',{user:''})).json()).events.length,0);
  process.env.EVENT_ENGINE_READ_ONLY='1';assert.equal((await request('/'+id,{body:publish})).status,403);assert.equal((await request('/'+id)).status,200);delete process.env.EVENT_ENGINE_READ_ONLY;
  process.env.RENDER_SERVICE_ID='preview';assert.equal((await request('/'+id,{body:publish})).status,403);delete process.env.RENDER_SERVICE_ID;
  assert.equal((await request('/'+id,{body:publish})).status,200);const publicReply=await request('/public',{user:''}),calendar=await publicReply.json();assert.equal(publicReply.headers.get('cache-control'),'private, no-store');assert.equal(calendar.events[0].title,'Website Fight Night');assert.equal(JSON.stringify(calendar).includes(user.steam_id),false);assert.equal(JSON.stringify(calendar).includes('Staff reviewed'),false);
  assert.equal((await request('/public?afterTime=bad&afterId='+id,{user:''})).status,400);
  db.exec('UPDATE users SET is_admin=0 WHERE id=1');assert.equal((await request('/'+id+'/history')).status,403);assert.equal((await request('/'+id,{body:publish})).status,403);
  process.env.EVENT_ENGINE_SCHEDULES_ENABLED='0';assert.deepEqual((await (await request('/public',{user:''})).json()).events,[]);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();for(const [k,v]of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
