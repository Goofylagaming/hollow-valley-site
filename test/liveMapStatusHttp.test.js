'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
process.env.DB_PATH=':memory:';
test('public map check is independent of worker collection, never exposes source details, and disabled means no read',async t=>{
 let reads=0,fail=false;const env={STATUS_COMPONENTS_PUBLIC_ENABLED:'1'};const app=express();app.use('/status',require('../server/routes/componentStatus').createRouter({env,getMapState:()=>{reads++;if(fail)throw Error('PRIVATE failure');return {configured:true,online:true,lastChecked:new Date().toISOString(),characters:[{name:'PRIVATE',steamId:'secret',location:{x:0,y:0}}]};}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));const get=()=>fetch('http://127.0.0.1:'+server.address().port+'/status');
 assert.equal((await (await get()).json()).components[1].code,'not-configured');assert.equal(reads,0);env.STATUS_COMPONENTS_MAP_ENABLED='1';let response=await get(),body=await response.json();assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(body.components[0].code,'not-configured');assert.equal(body.components[1].code,'usable');assert.doesNotMatch(JSON.stringify(body),/PRIVATE|secret|location|characters/);
 fail=true;body=await (await get()).json();assert.equal(body.components[1].code,'unavailable');assert.doesNotMatch(JSON.stringify(body),/PRIVATE/);
 env.STATUS_COMPONENTS_PUBLIC_ENABLED='0';const before=reads;assert.deepEqual(await (await get()).json(),{available:false,components:[]});assert.equal(reads,before);
});
test('authenticated positions preserve owner privacy and clear unavailable data with private no-store responses',async t=>{
 const source=require('../server/services/serverStatus'),original=source.getState;let fail=false;
 source.getState=()=>{if(fail)throw Error('PRIVATE source failure');return {configured:true,online:true,lastChecked:new Date().toISOString(),characters:[{steamId:'owner',name:'Mine',location:{x:0,y:0}},{steamId:'other',name:'Other',location:{x:100,y:200}}]};};t.after(()=>{source.getState=original;});
 const app=express();app.use((req,res,next)=>{if(req.headers['x-fixture-user'])req.user={steam_id:'owner',is_admin:req.headers['x-fixture-user']==='admin'};next();});app.use('/map',require('../server/routes/map'));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));const get=user=>fetch('http://127.0.0.1:'+server.address().port+'/map/positions',{headers:user?{'x-fixture-user':user}:{}});
 assert.equal((await get()).status,401);let response=await get('member'),body=await response.json();assert.equal(response.headers.get('cache-control'),'private, no-store');assert.ok(body.me.position);assert.equal(body.others[0].position,undefined);assert.ok((await (await get('admin')).json()).others[0].position);
 fail=true;response=await get('member');assert.equal(response.status,503);body=await response.json();assert.equal(body.me,null);assert.deepEqual(body.others,[]);assert.doesNotMatch(JSON.stringify(body),/PRIVATE/);
});
