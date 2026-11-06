'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createMarketplaceHealth,INTERVAL_MS,MAX_AGE_MS,TIMEOUT_MS}=require('../server/services/marketplaceHealth');
const AT=Date.parse('2026-11-06T01:02:03.123Z');
const sample=(at=AT,code='readable')=>({available:true,version:1,scope:'official-catalog-read',code,observedAt:new Date(at).toISOString(),checkoutVerified:false,fulfillmentVerified:false});
function fixture(readSource){let clock=AT,timeout,loop;const env={STATUS_COMPONENTS_MARKETPLACE_ENABLED:'1',AUTOMATION_SERVICE_URL:'https://private.invalid',HOLLOW_VALLEY_API_TOKEN:'PRIVATE TOKEN'};
 const service=createMarketplaceHealth({env,readSource,now:()=>clock,setTimer:(fn,ms)=>{assert.equal(ms,TIMEOUT_MS);timeout=fn;return 1;},clearTimer(){},setLoop:(fn,ms)=>{assert.equal(ms,INTERVAL_MS);loop=fn;return {unref(){}};},clearLoop(){loop=null;}});return {service,env,time:value=>{clock=value;},timeout:()=>timeout(),loop:()=>loop?.()};
}
test('disabled/unconfigured collection and public reads never query a source or start a loop',async()=>{
 let calls=0;const f=fixture(()=>{calls++;return sample();});delete f.env.STATUS_COMPONENTS_MARKETPLACE_ENABLED;await f.service.poll();f.service.start();assert.equal(f.service.read().code,'not-configured');f.env.STATUS_COMPONENTS_MARKETPLACE_ENABLED='1';delete f.env.HOLLOW_VALLEY_API_TOKEN;await f.service.poll();f.service.start();assert.equal(f.service.read().code,'integration-not-configured');assert.equal(calls,0);
});
test('only minimal source facts survive; both checkout and delivery remain unverified',async()=>{
 const f=fixture(()=>({...sample(),catalog:[{name:'PRIVATE ITEM',price:1234}],token:'PRIVATE TOKEN'}));assert.deepEqual(await f.service.poll(),{id:'marketplace-catalog',scope:'official-catalog-read',code:'readable',observedAt:new Date(AT).toISOString(),checkoutVerified:false,fulfillmentVerified:false});assert.doesNotMatch(JSON.stringify(f.service.read()),/PRIVATE|1234|catalog\":|token/);
});
test('schema, source clock and explicit scope limits reject ambiguous or upgraded observations',async()=>{
 for(const patch of [{available:false},{version:2},{scope:'all-marketplace'},{checkoutVerified:true},{fulfillmentVerified:true},{code:'healthy'},{observedAt:null},{observedAt:'2026-11-06T01:02:03'},{observedAt:new Date(AT+1).toISOString()}]){const f=fixture(()=>({...sample(),...patch}));assert.equal((await f.service.poll()).code,'invalid-observation');}
 const f=fixture(()=>sample(AT-MAX_AGE_MS-1));assert.equal((await f.service.poll()).code,'stale');
});
test('single flight and minute cadence do not advance a cached source or its first local check clock',async()=>{
 let resolve,calls=0;const f=fixture(()=>{calls++;return new Promise(r=>{resolve=r;});});const first=f.service.poll();assert.equal(first,f.service.poll());await Promise.resolve();resolve(sample());await first;f.time(AT+INTERVAL_MS-1);await f.service.poll();assert.equal(calls,1);f.time(AT+INTERVAL_MS);const second=f.service.poll();await Promise.resolve();resolve(sample());await second;f.time(AT+INTERVAL_MS-1000);assert.equal(f.service.read().code,'readable','duplicate retains first local check clock');f.time(AT+MAX_AGE_MS+1);assert.equal(f.service.read().code,'stale');assert.equal(f.service.read().observedAt,new Date(AT).toISOString());f.time(AT-1);assert.equal(f.service.read().code,'unverified-clock');
});
test('older or conflicting source facts cannot replace the accepted watermark; exact source retries recover safely',async()=>{
 let raw=sample();const f=fixture(()=>raw);await f.service.poll();for(const bad of [sample(AT-1),sample(AT,'empty-catalog')]){f.time(AT+INTERVAL_MS*(bad.code==='readable'?1:2));raw=bad;assert.equal((await f.service.poll()).code,'invalid-observation');}f.time(AT+3*INTERVAL_MS);raw=sample();assert.equal((await f.service.poll()).code,'readable');f.time(AT+3*INTERVAL_MS+1);assert.equal(f.service.read().code,'stale');
});
test('bounded source states remain distinct while transport failures expose no raw errors',async()=>{
 for(const code of ['empty-catalog','invalid-catalog','catalog-too-large','unavailable']){const f=fixture(()=>sample(AT,code));assert.equal((await f.service.poll()).code,code);}
 const f=fixture(()=>{throw Error('PRIVATE failure with token');});assert.equal((await f.service.poll()).code,'unavailable');assert.doesNotMatch(JSON.stringify(f.service.read()),/PRIVATE|token/);
});
test('deadline and stop settle ignored cancellation without allowing late results to replace observations',async()=>{
 let resolve,signal;const f=fixture(opts=>{signal=opts.signal;return new Promise(r=>{resolve=r;});});const pending=f.service.poll();await Promise.resolve();f.timeout();assert.equal((await pending).code,'timed-out');assert.equal(signal.aborted,true);resolve(sample());await Promise.resolve();assert.equal(f.service.read().code,'timed-out');
 let done;const g=fixture(()=>new Promise(r=>{done=r;}));const stop=g.service.start(),work=g.service.poll();await Promise.resolve();stop();await work;done(sample());await Promise.resolve();assert.equal(g.service.read().code,'no-observation');
});
test('integration changes invalidate old observations and suppress an old in-flight source',async()=>{
 let resolve;const f=fixture(()=>new Promise(r=>{resolve=r;}));const pending=f.service.poll();await Promise.resolve();f.env.AUTOMATION_SERVICE_URL='https://replacement.invalid';assert.equal(f.service.read().code,'no-observation');await pending;resolve(sample());await Promise.resolve();assert.equal(f.service.read().code,'no-observation');f.env.STATUS_COMPONENTS_MARKETPLACE_ENABLED='0';assert.equal(f.service.read().code,'not-configured');
});
