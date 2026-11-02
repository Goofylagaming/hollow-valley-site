const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const client=require('../server/services/premiumSkinClient');
const router=require('../server/routes/premiumSkins');
const OWNER='76561198000000001';
async function fixture(t,user){
  const previous=process.env.SKIN_STUDIO_READ_ONLY;process.env.SKIN_STUDIO_READ_ONLY='false';
  const calls=[];const originals={};
  for(const name of ['listCatalog','listAdmin','seedDrafts','draftFromPreset','updateDraft','verifyDraft','setPublished']){
    originals[name]=client[name];client[name]=async(arg)=>{calls.push({name,arg});return {enabled:true,skins:[]};};
  }
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user=user;next();});app.use('/api/skins/premium',router);
  const server=app.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  const base=`http://127.0.0.1:${server.address().port}/api/skins/premium`;
  t.after(async()=>{for(const [name,value]of Object.entries(originals))client[name]=value;if(previous===undefined)delete process.env.SKIN_STUDIO_READ_ONLY;else process.env.SKIN_STUDIO_READ_ONLY=previous;await new Promise(resolve=>server.close(resolve));});
  return {calls,request:(path='',body,method,headers={})=>fetch(base+path,{method:method||(body===undefined?'GET':'POST'),headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)})};
}
test('guest sees public collection but cannot inspect or mutate private drafts',async(t)=>{
  const f=await fixture(t,null);assert.equal((await f.request()).status,200);
  assert.equal((await f.request('/admin')).status,401);assert.equal((await f.request('/admin/seed-drafts',{})).status,401);
  assert.deepEqual(f.calls.map(x=>x.name),['listCatalog']);
});
test('ordinary signed-in member cannot create, verify or publish premium collections',async(t)=>{
  const f=await fixture(t,{id:2,steam_id:OWNER,is_admin:0});
  for(const path of ['/admin/drafts','/admin/skin-123/verify','/admin/skin-123/publish'])assert.equal((await f.request(path,{})).status,403);
  assert.equal(f.calls.length,0);
});
test('administrator identity comes from session and publication requires an explicit boolean',async(t)=>{
  const f=await fixture(t,{id:1,steam_id:OWNER,is_admin:1});
  assert.equal((await f.request('/admin/skin-123/publish',{published:true,actorSteamId:'76561198099999999'})).status,200);
  assert.equal(f.calls[0].arg.actorSteamId,OWNER);assert.equal(f.calls[0].arg.published,true);
});
test('read-only preview blocks premium mutation before the upstream client is called',async(t)=>{
  const f=await fixture(t,{id:1,steam_id:OWNER,is_admin:1});process.env.SKIN_STUDIO_READ_ONLY='true';
  assert.equal((await f.request('/admin/seed-drafts',{})).status,403);
  assert.equal((await f.request('/admin/skin-123',{},'PUT')).status,403);
  assert.equal((await f.request('/admin/skin-123/verify',{})).status,403);
  assert.equal((await f.request('/admin/skin-123/publish',{})).status,403);
  assert.equal(f.calls.length,0);assert.equal((await f.request('/admin')).status,200);
});
test('cross-origin admin writes are rejected before forwarding',async(t)=>{
  const f=await fixture(t,{id:1,steam_id:OWNER,is_admin:1});
  assert.equal((await f.request('/admin/seed-drafts',{},'POST',{Origin:'https://unrelated.example'})).status,403);
  assert.equal(f.calls.length,0);
});
