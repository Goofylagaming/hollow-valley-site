'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const client=require('../server/services/automationWebsiteClient');
process.env.VALLEY_ARCADE_ENABLED='1';process.env.VALLEY_ARCADE_REWARDS_ENABLED='1';
async function fixture(t,user){
  const calls=[],original=client.arcadeRewardsRequest;
  client.arcadeRewardsRequest=async(action,body)=>{calls.push({action,body});return {ok:true};};
  delete require.cache[require.resolve('../server/routes/arcadeRewards')];
  const app=express();app.use(express.json());app.use((req,res,next)=>{req.user=user;next();});
  app.use('/api/arcade',require('../server/routes/arcadeRewards'));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{client.arcadeRewardsRequest=original;await new Promise(resolve=>server.close(resolve));});
  return {calls,request:(path='',body,originOverride=origin)=>fetch(origin+'/api/arcade'+path,{method:body?'POST':'GET',
    headers:{Origin:originOverride,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined})};
}
test('anonymous users cannot read inventory or grant rewards',async t=>{
  const f=await fixture(t,null);assert.equal((await f.request()).status,401);assert.equal((await f.request('/admin/grant',{})).status,401);assert.equal(f.calls.length,0);
});
test('members cannot administer rewards and player identity comes only from session',async t=>{
  const f=await fixture(t,{id:7,steam_id:'76561198000000111',is_admin:0});
  assert.equal((await f.request('/admin')).status,403);
  assert.equal((await f.request('/admin/grant',{})).status,403);
  assert.equal((await f.request('/open',{steamId:'76561198000000999',crateId:'crate',requestKey:'test-key-1',reward:'dinosaur',amount:999})).status,200);
  assert.deepEqual(f.calls[0].body,{steamId:'76561198000000111',crateId:'crate',requestKey:'test-key-1'});
});
test('cross-origin posts are rejected before any upstream mutation',async t=>{
  const f=await fixture(t,{id:1,steam_id:'76561198000000111',is_admin:1});
  assert.equal((await f.request('/daily',{},'https://attacker.example')).status,403);assert.equal(f.calls.length,0);
});
test('admin actor cannot be spoofed and private responses cannot be cached',async t=>{
  const f=await fixture(t,{id:12,steam_id:'76561198000000111',is_admin:1});
  const r=await f.request('/admin/grant',{actor:'spoof',steamId:'76561198000000112',requestKey:'evidence-123',kind:'crate',family:'event',amount:1,source:'event'});
  assert.equal(r.status,200);assert.equal(f.calls[0].body.actor,'12');assert.match(r.headers.get('cache-control'),/no-store/);
});
test('disabled rewards feature blocks reads and writes',async t=>{
  const f=await fixture(t,{id:12,steam_id:'76561198000000111',is_admin:1});
  process.env.VALLEY_ARCADE_REWARDS_ENABLED='0';t.after(()=>process.env.VALLEY_ARCADE_REWARDS_ENABLED='1');
  assert.equal((await f.request()).status,404);assert.equal((await f.request('/daily',{})).status,404);assert.equal(f.calls.length,0);
});
