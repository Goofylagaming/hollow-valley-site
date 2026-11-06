'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {positions,health,position}=require('../server/services/liveMapProjection');
const {current}=require('../public/assets/live-map-observation');
const AT=Date.parse('2026-11-06T01:02:03.123Z'),iso=n=>new Date(n).toISOString();
const character=(steamId='private-owner')=>({steamId,name:'PRIVATE NAME',species:'Rex',location:{x:0,y:0,z:0},health:88});
const state=()=>({configured:true,online:true,lastChecked:iso(AT),characters:[character(),character('private-other')],playerCount:2,maxPlayers:100});
test('valid zero coordinates project; missing and outside coordinates never become clamped edge markers',()=>{
 assert.ok(position(character()).position);
 for(const location of [null,{}, {x:'bad',y:0},{x:1e9,y:0}])assert.equal(position({location}).position,null);
 const outside=position({location:{x:1e9,y:0}});assert.ok(outside.coords);assert.equal(outside.region,null);assert.equal(outside.grid,null);
});
test('owner and admin receive private details; regular others have no coordinate or identity fields',()=>{
 const s=state(),before=JSON.stringify(s);const regular=positions(s,{steam_id:'private-owner'},AT);
 assert.ok(regular.me.position);assert.deepEqual(Object.keys(regular.others[0]).sort(),['isPrime','name','species']);assert.doesNotMatch(JSON.stringify(regular),/private-owner|private-other/);
 assert.ok(positions(s,{steam_id:'private-owner',is_admin:1},AT).others[0].position);assert.equal(JSON.stringify(s),before);
 const publicHealth=health(s,AT);assert.deepEqual(publicHealth,{id:'map-source',scope:'cached-position-source',code:'usable',observedAt:iso(AT),renderingVerified:false});
});
test('source clocks and stale flags take precedence over offline; missing clocks never acquire receiving time',()=>{
 for(const [patch,code] of [[{lastChecked:null},'unverified-clock'],[{lastChecked:'2026-11-06T01:02:03'},'unverified-clock'],[{lastChecked:iso(AT+1)},'unverified-clock'],[{lastChecked:iso(AT-120001)},'stale'],[{online:false,stale:true},'stale'],[{online:false},'verified-offline'],[{online:null},'unavailable'],[{configured:false},'not-configured']]){
  const s={...state(),...patch};assert.equal(health(s,AT).code,code);const value=positions(s,{steam_id:'private-owner'},AT);assert.equal(value.connected,false);assert.equal(value.me,null);assert.deepEqual(value.others,[]);
 }
 assert.equal(health({...state(),lastChecked:iso(AT-120000)},AT).code,'usable');
});
test('empty, malformed and unprojectable sources remain distinct without publishing player data',()=>{
 assert.equal(health({...state(),characters:[]},AT).code,'no-position-observation');
 for(const characters of [null,{},Array(1001).fill(character())])assert.equal(health({...state(),characters},AT).code,'unavailable');
 for(const characters of [[null],[{...character(),location:null}],[{...character(),location:{x:1e9,y:0}}]])assert.equal(health({...state(),characters},AT).code,'unprojectable');
});
test('browser rejects cached, future or malformed observations and clears all markers without mutating input',()=>{
 const good=positions(state(),{steam_id:'private-owner'},AT);assert.equal(current(good,AT),good);assert.equal(current(good,AT+120000),good);
 for(const lastChecked of [iso(AT-120001),iso(AT+1),null,'bad','2026-11-06T01:02:03']){
  const value={...good,lastChecked},before=JSON.stringify(value),result=current(value,AT);assert.equal(result.connected,false);assert.equal(result.me,null);assert.deepEqual(result.others,[]);assert.equal(JSON.stringify(value),before);
 }
 assert.equal(current({...good,connected:false},AT).me,null);assert.equal(current(null,AT).connected,false);
});
