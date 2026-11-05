'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createSteamProviderHealth,ENDPOINT,INTERVAL_MS,MAX_AGE_MS,TIMEOUT_MS}=require('../server/services/steamProviderHealth');
const AT=Date.parse('2026-11-06T01:02:03.123Z');
function fixture(fetchImpl){let clock=AT,timeout,loop,cleared=0;const env={STATUS_COMPONENTS_STEAM_ENABLED:'1',STEAM_RETURN_URL:'https://private.example/auth/steam/callback',STEAM_REALM:'https://private.example',STEAM_API_KEY:'PRIVATE KEY'};
 const service=createSteamProviderHealth({env,fetchImpl,now:()=>clock,setTimer:(fn,delay)=>{assert.equal(delay,TIMEOUT_MS);timeout=fn;return 1;},clearTimer:()=>{cleared++;},setLoop:(fn,delay)=>{assert.equal(delay,INTERVAL_MS);loop=fn;return {unref(){}};},clearLoop:()=>{loop=null;}});
 return {service,env,time:value=>{clock=value;},timeout:()=>timeout(),loop:()=>loop?.(),get cleared(){return cleared;}};
}
const response=(status=200,type='application/xrds+xml')=>({status,headers:new Headers({'content-type':type}),body:{cancel:()=>Promise.resolve()}});
test('disabled or unconfigured monitoring performs no request or scheduling; reads never initiate a request',async()=>{
 let calls=0;const f=fixture(()=>{calls++;return response();});delete f.env.STATUS_COMPONENTS_STEAM_ENABLED;assert.equal(f.service.read().code,'not-configured');await f.service.poll();f.service.start();assert.equal(calls,0);
 f.env.STATUS_COMPONENTS_STEAM_ENABLED='1';delete f.env.STEAM_REALM;assert.equal(f.service.read().code,'login-not-configured');await f.service.poll();f.service.start();assert.equal(calls,0);
 f.env.STEAM_REALM='https://private.example';assert.equal(f.service.read().code,'no-observation');assert.equal(calls,0);
});
test('only the fixed provider endpoint receives a credential-free discovery GET; body and configuration never enter public results',async()=>{
 let request,cancelled=0;const f=fixture((url,options)=>{request={url,options};return {...response(),body:{cancel:()=>{cancelled++;return Promise.resolve();}}};});
 const value=await f.service.poll();assert.equal(request.url,ENDPOINT);assert.equal(request.options.method,'GET');assert.equal(request.options.redirect,'manual');assert.equal(request.options.credentials,'omit');assert.deepEqual(request.options.headers,{Accept:'application/xrds+xml'});assert.equal(request.options.body,undefined);assert.ok(request.options.signal);assert.equal(cancelled,1);assert.equal(f.cleared,1);
 assert.deepEqual(value,{id:'steam-openid',scope:'provider-discovery-http',code:'responded',observedAt:new Date(AT).toISOString(),linkingVerified:false});assert.doesNotMatch(JSON.stringify(value),/PRIVATE|private.example|KEY|token|headers|url/);
});
test('HTTP errors, redirects and HTML challenge pages never count as successful discovery; transport exceptions are private',async()=>{
 for(const r of [response(302),response(429),response(500),response(200,'text/html'),response(204)]){const f=fixture(()=>r);assert.equal((await f.service.poll()).code,'unexpected-response');}
 const f=fixture(()=>{throw Error('PRIVATE network failure');});assert.equal((await f.service.poll()).code,'unavailable');assert.doesNotMatch(JSON.stringify(f.service.read()),/PRIVATE/);
});
test('requests are single flight and rate limited, with source time preserved across cached reads and clock rollback',async()=>{
 let resolve,calls=0;const f=fixture(()=>{calls++;return new Promise(r=>{resolve=r;});});const first=f.service.poll();assert.equal(f.service.poll(),first);await Promise.resolve();f.time(AT+2000);resolve(response());await first;assert.equal(calls,1);assert.equal(f.service.read().observedAt,new Date(AT).toISOString());await f.service.poll();assert.equal(calls,1);
 f.time(AT+MAX_AGE_MS);assert.equal(f.service.read().code,'responded');f.time(AT+MAX_AGE_MS+1);assert.equal(f.service.read().code,'stale');f.time(AT-1);assert.equal(f.service.read().code,'unverified-clock');await f.service.poll();assert.equal(calls,1);
});
test('timeouts settle even if fetch ignores abort; late responses never rewrite the timeout observation',async()=>{
 let resolve,signal;const f=fixture((_url,opts)=>{signal=opts.signal;return new Promise(r=>{resolve=r;});});const pending=f.service.poll();await Promise.resolve();f.timeout();assert.equal((await pending).code,'timed-out');assert.equal(signal.aborted,true);resolve(response());await Promise.resolve();assert.equal(f.service.read().code,'timed-out');
});
test('stop clears scheduling and history; stopped in-flight results cannot repopulate monitoring',async()=>{
 let resolve,calls=0;const f=fixture(()=>{calls++;return new Promise(r=>{resolve=r;});});const stop=f.service.start();f.service.start();const pending=f.service.poll();await Promise.resolve();assert.equal(calls,1);stop();await pending;assert.equal(f.service.read().code,'no-observation');resolve(response());await Promise.resolve();assert.equal(f.service.read().code,'no-observation');f.loop();assert.equal(calls,1);
});
test('configuration withdrawal suppresses an in-flight observation and all public reads',async()=>{
 let resolve;const f=fixture(()=>new Promise(r=>{resolve=r;}));const pending=f.service.poll();await Promise.resolve();f.env.STATUS_COMPONENTS_STEAM_ENABLED='0';resolve(response());await pending;assert.equal(f.service.read().code,'not-configured');f.env.STATUS_COMPONENTS_STEAM_ENABLED='1';assert.equal(f.service.read().code,'no-observation');
});
test('restart takes a new observation and a late previous transport cannot overwrite it',async()=>{
 const pending=[];const f=fixture(()=>new Promise(resolve=>pending.push(resolve)));
 f.service.start();const first=f.service.poll();await Promise.resolve();f.service.stop();await first;
 f.time(AT+INTERVAL_MS);f.service.start();const second=f.service.poll();await Promise.resolve();assert.equal(pending.length,2);
 pending[1](response(503));await second;assert.equal(f.service.read().code,'unexpected-response');assert.equal(f.service.read().observedAt,new Date(AT+INTERVAL_MS).toISOString());pending[0](response());await Promise.resolve();assert.equal(f.service.read().code,'unexpected-response');f.service.stop();
});
