'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createDiscordBridgeHealth,createRequestObserver,MAX_AGE_MS}=require('../src/services/discordBridgeHealthService');
const AT=Date.parse('2026-11-06T01:02:03.123Z');
function fixture(){let clock=AT;const env={STATUS_DISCORD_BRIDGE_HEALTH_ENABLED:'1',HERBYBOT_AUTOMATION_TOKEN:'PRIVATE TOKEN'};return {env,time:value=>{clock=value;},source:createDiscordBridgeHealth({env,now:()=>clock})};}
test('disabled, unconfigured and unobserved bridge contact cannot imply gateway readiness',()=>{
 const f=fixture();assert.equal(f.source.read().code,'no-observation');delete f.env.STATUS_DISCORD_BRIDGE_HEALTH_ENABLED;assert.equal(f.source.begin(),null);assert.equal(f.source.read().code,'not-configured');f.env.STATUS_DISCORD_BRIDGE_HEALTH_ENABLED='1';delete f.env.HERBYBOT_AUTOMATION_TOKEN;assert.equal(f.source.begin(),null);assert.equal(f.source.read().code,'bridge-not-configured');
});
test('completed requests retain the original start clock and expose no identity, message or delivery claim',()=>{
 const f=fixture(),token=f.source.begin();f.time(AT+1000);assert.equal(f.source.complete(token,true),true);assert.deepEqual(f.source.read(),{version:1,scope:'authenticated-bot-bridge-contact',code:'request-returned',observedAt:new Date(AT).toISOString(),gatewayVerified:false,deliveryVerified:false});assert.equal(f.source.complete(token,false),false);assert.doesNotMatch(JSON.stringify(f.source.read()),/PRIVATE|TOKEN|message|channel|guild|identity/);f.time(AT+MAX_AGE_MS+1);assert.equal(f.source.read().code,'stale');assert.equal(f.source.read().observedAt,new Date(AT).toISOString());
});
test('failed responses, one-use tokens, concurrent completions and token rotation retain bounded provenance',()=>{
 const f=fixture(),older=f.source.begin(),newer=f.source.begin();assert.equal(f.source.complete(newer,false),true);assert.equal(f.source.complete(older,true),false);assert.equal(f.source.read().code,'request-failed');const pending=f.source.begin();f.env.HERBYBOT_AUTOMATION_TOKEN='replacement';assert.equal(f.source.complete(pending,true),false);assert.equal(f.source.read().code,'no-observation');
});
test('invalid/backwards clocks and non-boolean completion do not fabricate contact',()=>{
 const f=fixture(),token=f.source.begin();f.time(AT-1);assert.equal(f.source.complete(token,true),false);f.time(AT);f.source.complete(f.source.begin(),true);f.time(AT-1);assert.equal(f.source.read().code,'unverified-clock');for(const at of [NaN,-1,1.5,Infinity,8640000000000001]){f.time(at);assert.equal(f.source.begin(),null);}f.time(AT);assert.equal(f.source.complete(f.source.begin(),'true'),false);
});
test('middleware observes only finished existing polling routes; health/unknown routes and interrupted replies do not make contact',()=>{
 const f=fixture(),observe=createRequestObserver({getService:()=>f.source});let next=0;const response=new EventEmitter();response.statusCode=200;observe({method:'GET',path:'/status'},response,()=>next++);assert.equal(f.source.read().code,'no-observation');response.emit('close');assert.equal(f.source.read().code,'no-observation');response.emit('finish');assert.equal(f.source.read().code,'no-observation');assert.equal(next,1);const completed=new EventEmitter();completed.statusCode=200;observe({method:'GET',path:'/status'},completed,()=>{});completed.emit('finish');assert.equal(f.source.read().code,'request-returned');
 const unobserved=fixture(),ignored=createRequestObserver({getService:()=>unobserved.source});for(const [method,path]of [['GET','/discord/health'],['GET','/unknown'],['POST','/announcements'],['GET','/outbox/claim']]){const res=new EventEmitter();res.statusCode=200;ignored({method,path},res,()=>{});res.emit('finish');}assert.equal(unobserved.source.read().code,'no-observation');
});
test('observer failures do not affect the existing response or middleware progression',()=>{
 let next=0;createRequestObserver({getService(){throw Error('PRIVATE');}})({method:'GET',path:'/status'},new EventEmitter(),()=>next++);assert.equal(next,1);const res=new EventEmitter();res.statusCode=500;createRequestObserver({getService:()=>({begin:()=>({}),complete(){throw Error('PRIVATE');}})})({method:'POST',path:'/outbox/claim'},res,()=>next++);assert.doesNotThrow(()=>res.emit('finish'));assert.equal(next,2);
});
