const {test}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {once}=require('node:events');
const {createRelay}=require('../src/services/herbyBotAdminRelay');
const {requireHerbyBotToken}=require('../src/middleware/herbyBotAuth');
test('outbound relay authenticates worker, bounds requests, preserves private cookies and never replays jobs',async()=>{
  process.env.HERBY_ADMIN_RELAY_ENABLED='true';process.env.HERBYBOT_AUTOMATION_TOKEN='test-only';
  const relay=createRelay({timeoutMs:1000});const app=express();
  app.use('/herby-admin',relay.front);
  app.use('/relay',requireHerbyBotToken,express.json(),relay.router);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  const auth={Authorization:'Bearer test-only','Content-Type':'application/json'};
  try{
    assert.equal((await fetch(base+'/relay/jobs')).status,401);
    const page=fetch(base+'/herby-admin/access',{method:'POST',body:'csrf=test&code=private',headers:{'Content-Type':'application/x-www-form-urlencoded','Cookie':'herby_admin=private'}});
    const {job}=await (await fetch(base+'/relay/jobs',{headers:auth})).json();
    assert.equal(job.path,'/herby-admin/access');assert.equal(job.headers.cookie,'herby_admin=private');
    assert.equal(Buffer.from(job.body,'base64').toString(),'csrf=test&code=private');
    let response=await fetch(base+'/relay/jobs/'+job.id,{method:'POST',headers:auth,body:JSON.stringify({status:302,headers:[['Location','/herby-admin/servers/test'],['Set-Cookie','herby_admin=session; Secure; HttpOnly; Path=/herby-admin']],body:''})});
    assert.equal(response.status,200);
    // Native fetch follows redirects: the new request is never authenticated by the relay itself.
    const {job:next}=await (await fetch(base+'/relay/jobs',{headers:auth})).json();
    assert.equal(next.path,'/herby-admin/servers/test');
    await fetch(base+'/relay/jobs/'+next.id,{method:'POST',headers:auth,body:JSON.stringify({status:401,headers:[],body:''})});
    assert.equal((await page).status,401);
    assert.equal((await fetch(base+'/relay/jobs/'+job.id,{method:'POST',headers:auth,body:'{}'})).status,410);
    assert.equal((await fetch(base+'/herby-admin/access',{method:'POST',body:'x'.repeat(17000)})).status,413);
    assert.equal((await fetch(base+'/herby-admin/access',{method:'DELETE'})).status,405);
    assert.equal((await fetch(base+'/herby-admin/..%2fsecret')).status,400);
    assert.equal((await fetch(base+'/herby-admin/access')).status,504);
  } finally {delete process.env.HERBY_ADMIN_RELAY_ENABLED;delete process.env.HERBYBOT_AUTOMATION_TOKEN;server.closeAllConnections();await new Promise(r=>server.close(r));}
});
