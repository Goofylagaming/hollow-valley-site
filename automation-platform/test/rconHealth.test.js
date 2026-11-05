'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createRconHealth,MAX_AGE_MS}=require('../src/services/rconHealthService');
const AT=Date.parse('2026-11-06T01:02:03.123Z');
function fixture(){let clock=AT;const env={STATUS_RCON_HEALTH_ENABLED:'1',RCON_HOST:'PRIVATE HOST',RCON_PORT:'8888',RCON_PASSWORD:'PRIVATE PASSWORD'};return {env,time:at=>{clock=at;},service:createRconHealth({env,now:()=>clock})};}
test('unobserved, disabled and unconfigured sources do not infer connectivity or create observations',()=>{
 const f=fixture();assert.equal(f.service.read().code,'no-observation');delete f.env.STATUS_RCON_HEALTH_ENABLED;assert.equal(f.service.begin(),null);assert.equal(f.service.read().code,'not-configured');f.env.STATUS_RCON_HEALTH_ENABLED='1';f.env.RCON_DISABLED='true';assert.equal(f.service.begin(),null);assert.equal(f.service.read().code,'rcon-disabled');delete f.env.RCON_DISABLED;delete f.env.RCON_PASSWORD;assert.equal(f.service.begin(),null);assert.equal(f.service.read().code,'connection-not-configured');
});
test('only completed existing reads produce minimal original-start-time facts; repeats cannot restamp them',()=>{
 const f=fixture(),token=f.service.begin();assert.equal(f.service.read().code,'no-observation');f.time(AT+5000);assert.equal(f.service.complete(token,true),true);assert.deepEqual(f.service.read(),{version:1,scope:'automation-rcon-status-read',code:'read-returned',observedAt:new Date(AT).toISOString(),commandExecutionVerified:false,playerDataVerified:false});assert.equal(f.service.complete(token,false),false);assert.doesNotMatch(JSON.stringify(f.service.read()),/PRIVATE|8888|password|host|players/);f.time(AT+MAX_AGE_MS);assert.equal(f.service.read().code,'read-returned');f.time(AT+MAX_AGE_MS+1);assert.equal(f.service.read().code,'stale');
});
test('failed reads remain distinct and cannot rewrite newer completed reads',()=>{
 const f=fixture(),older=f.service.begin(),newer=f.service.begin();assert.equal(f.service.complete(newer,false),true);assert.equal(f.service.read().code,'read-failed');assert.equal(f.service.complete(older,true),false);assert.equal(f.service.read().code,'read-failed');assert.equal(f.service.complete({},true),false);
});
test('configuration changes discard old observations and pending request tokens',()=>{
 const f=fixture(),pending=f.service.begin();f.env.RCON_PASSWORD='replacement';assert.equal(f.service.complete(pending,true),false);assert.equal(f.service.read().code,'no-observation');const next=f.service.begin();f.service.complete(next,true);f.env.RCON_DISABLED='true';assert.equal(f.service.read().code,'rcon-disabled');delete f.env.RCON_DISABLED;assert.equal(f.service.read().code,'no-observation');
});
test('missing/backwards clocks and non-boolean outcomes cannot fabricate a fresh success',()=>{
 const f=fixture(),pending=f.service.begin();f.time(AT-1);assert.equal(f.service.complete(pending,true),false);assert.equal(f.service.read().code,'no-observation');f.time(AT);assert.equal(f.service.complete(f.service.begin(),true),true);f.time(AT-1);assert.equal(f.service.read().code,'unverified-clock');for(const at of [NaN,-1,1.5,Infinity,8640000000000001]){f.time(at);assert.equal(f.service.begin(),null);}f.time(AT);assert.equal(f.service.complete(f.service.begin(),'true'),false);
});
