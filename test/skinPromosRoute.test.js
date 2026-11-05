const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const client=require('../server/services/skinPromoClient');
test('promo routes enforce rollout, session identity, admin authority, origin and preview restrictions',async()=>{
  const keys=['SKIN_PROMO_CODES_ENABLED','SKIN_STUDIO_READ_ONLY','RENDER_SERVICE_ID','RENDER_EXTERNAL_URL','PUBLIC_SITE_URL','STEAM_REALM','STEAM_RETURN_URL'];
  const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));for(const k of keys)delete process.env[k];
  const originals={...client},calls=[];for(const name of Object.keys(client))client[name]=async body=>{calls.push({name,body});return {ok:true};};
  const app=express();app.use(express.json());app.use((req,_res,next)=>{if(req.get('x-user'))req.user={id:1,steam_id:req.get('x-user'),is_admin:req.get('x-admin')==='1'};next();});app.use('/promos',require('../server/routes/skinPromos'));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const origin=`http://127.0.0.1:${server.address().port}`,steam='76561198000000001';
  const send=(path,body={},headers={})=>fetch(origin+'/promos'+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,'x-user':steam,...headers},body:JSON.stringify(body)});
  try{
    const capabilities=await fetch(origin+'/promos/capabilities');assert.equal(capabilities.status,200);assert.equal((await capabilities.json()).enabled,false);
    assert.equal((await send('/redeem')).status,503);process.env.SKIN_PROMO_CODES_ENABLED='1';
    assert.equal((await send('/redeem',{}, {'x-user':''})).status,401);
    assert.equal((await send('/redeem',{}, {Origin:'https://other.invalid'})).status,403);
    assert.equal((await send('/admin/issue')).status,403);
    assert.equal((await send('/redeem',{code:'secret',steamId:'76561198999999999'})).status,200);
    assert.deepEqual(calls.pop(),{name:'redeem',body:{steamId:steam,code:'secret'}});
    const response=await send('/admin/issue',{presetId:'fixture',code:'secret',reason:'Fixture approval',expiresAt:10,requestId:'request-1',actorSteamId:'76561198999999999'},{'x-admin':'1'});
    assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
    assert.equal(calls.pop().body.actorSteamId,steam);
    process.env.SKIN_STUDIO_READ_ONLY='true';assert.equal((await (await fetch(origin+'/promos/capabilities')).json()).readOnly,true);assert.equal((await send('/redeem')).status,403);
    assert.equal((await send('/admin/revoke',{}, {'x-admin':'1'})).status,403);
    assert.equal(calls.length,0);
  }finally{await new Promise(resolve=>server.close(resolve));Object.assign(client,originals);for(const [k,v] of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
