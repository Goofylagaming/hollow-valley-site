'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {createSteamProviderHealth}=require('../server/services/steamProviderHealth');
const {createRouter}=require('../server/routes/componentStatus');
test('public Steam observations are read-only cached projections with no credentials, endpoint details or user writes',async t=>{
 let calls=0,clock=Date.now();const env={STATUS_COMPONENTS_PUBLIC_ENABLED:'1',STATUS_COMPONENTS_STEAM_ENABLED:'1',STEAM_REALM:'https://private.example',STEAM_RETURN_URL:'https://private.example/callback'};
 const service=createSteamProviderHealth({env,now:()=>clock,fetchImpl:async()=>{calls++;return {status:200,headers:new Headers({'content-type':'application/xrds+xml'}),body:{cancel:async()=>{}}};}});
 const app=express();app.use('/status',createRouter({env,getSteamHealth:service.read}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));const get=()=>fetch('http://127.0.0.1:'+server.address().port+'/status');
 assert.equal((await (await get()).json()).components[2].code,'no-observation');assert.equal(calls,0);await service.poll();
 for(let i=0;i<3;i++){const response=await get(),body=await response.json();assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(body.components[2].code,'responded');assert.equal(body.components[2].linkingVerified,false);assert.doesNotMatch(JSON.stringify(body),/private.example|callback|cookie|steamcommunity|identity/);}
 assert.equal(calls,1);clock+=180001;assert.equal((await (await get()).json()).components[2].code,'stale');env.STATUS_COMPONENTS_STEAM_ENABLED='0';assert.equal((await (await get()).json()).components[2].code,'not-configured');assert.equal(calls,1);
});
