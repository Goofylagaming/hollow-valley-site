const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const client=require('../server/services/skinGiftClient');
test('gift routes bind every actor to the session and block guests, cross-origin writes and previews',async()=>{
  const keys=['SKIN_GIFTING_ENABLED','SKIN_STUDIO_READ_ONLY','RENDER_SERVICE_ID','RENDER_EXTERNAL_URL','PUBLIC_SITE_URL','STEAM_REALM','STEAM_RETURN_URL'];
  const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));for(const k of keys)delete process.env[k];
  const originals={...client},calls=[];for(const name of Object.keys(client))client[name]=async body=>{calls.push({name,body});return {ok:true};};
  const app=express();app.use(express.json());app.use((req,_res,next)=>{if(req.get('x-user'))req.user={id:1,steam_id:req.get('x-user')};next();});app.use('/gifts',require('../server/routes/skinGifts'));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const origin=`http://127.0.0.1:${server.address().port}`,steam='76561198000000001';
  const send=(path,body={},headers={})=>fetch(origin+'/gifts'+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,'x-user':steam,...headers},body:JSON.stringify(body)});
  try{
    assert.equal((await (await fetch(origin+'/gifts/capabilities')).json()).enabled,false);
    assert.equal((await send('/offer')).status,503);process.env.SKIN_GIFTING_ENABLED='1';
    assert.equal((await fetch(origin+'/gifts')).status,401);
    assert.equal((await send('/offer',{}, {'x-user':''})).status,401);
    assert.equal((await send('/decide',{}, {'x-user':'bad'})).status,403);
    assert.equal((await send('/offer',{}, {Origin:'https://other.invalid'})).status,403);
    assert.equal((await send('/offer',{}, {Origin:''})).status,403);
    for(const path of ['', '/eligible']){
      const response=await fetch(origin+'/gifts'+path+'?steamId=76561198999999999',{headers:{'x-user':steam}});
      assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(calls.pop().body.steamId,steam);
    }
    assert.equal((await send('/offer',{steamId:'76561198999999999',presetId:'skin',recipientSteamId:'76561198000000002',requestId:'fixture-request',note:'Hello'})).status,200);
    assert.deepEqual(calls.pop(),{name:'offer',body:{steamId:steam,presetId:'skin',recipientSteamId:'76561198000000002',requestId:'fixture-request',note:'Hello'}});
    assert.equal((await send('/decide',{steamId:'76561198999999999',id:'gift',decision:'accepted',expectedRevision:0})).status,200);
    assert.deepEqual(calls.pop(),{name:'decide',body:{steamId:steam,id:'gift',decision:'accepted',expectedRevision:0}});
    assert.equal((await send('/reconcile',{steamId:'76561198999999999'})).status,200);assert.deepEqual(calls.pop(),{name:'reconcile',body:{steamId:steam,cursor:0}});
    assert.equal((await send('/reconcile',{steamId:'76561198999999999',cursor:10})).status,200);assert.deepEqual(calls.pop(),{name:'reconcile',body:{steamId:steam,cursor:10}});
    process.env.SKIN_STUDIO_READ_ONLY='true';assert.equal((await send('/reconcile')).status,403);assert.equal((await send('/offer')).status,403);assert.equal((await send('/decide')).status,403);
    assert.equal(calls.length,0);
  }finally{await new Promise(resolve=>server.close(resolve));Object.assign(client,originals);for(const [k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
