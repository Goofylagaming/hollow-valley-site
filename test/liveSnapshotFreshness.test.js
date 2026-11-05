"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {observation,MAX_LIVE_SAMPLE_AGE_MS}=require('../server/services/liveSnapshotFreshness');
function setup(){
  let time=Date.parse('2026-11-05T10:00:00Z'),next=null,saves=[];
  const OriginalDate=Date;
  const Clock=class extends OriginalDate{constructor(...args){super(...(args.length?args:[time]));}static now(){return time;}};
  const module={exports:{}};
  const context={module,exports:module.exports,Date:Clock,process:{env:{AUTOMATION_SERVICE_URL:'https://synthetic.invalid',HOLLOW_VALLEY_API_TOKEN:'synthetic'}},console:{log(){},warn(){}},setInterval(){throw new Error('Polling timers are not used by this fixture');},require(name){
    if(name==='./automationWebsiteClient')return {getServerSnapshot:async()=>{if(next instanceof Error)throw next;return next;}};
    if(name==='./readSnapshots')return {load:()=>null,save:(_key,value)=>saves.push(JSON.parse(JSON.stringify(value)))};
    if(name==='./liveSnapshotFreshness')return {observation};
    throw new Error('Unexpected status dependency: '+name);
  }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../server/services/serverStatus.js'),'utf8'),context);
  const good=()=>({online:true,players:[{steamId:'76561198000000001'}],characters:[{steamId:'76561198000000001',location:{x:123,y:456}}],checkedAt:new Clock().toISOString(),error:null});
  return {status:module.exports,advance:n=>time+=n,set:value=>next=value,good,saves,at:()=>time};
}
test('only an actual non-stale observation within two minutes is fresh',()=>{
  const now=Date.parse('2026-11-05T10:00:00Z'),state={lastChecked:new Date(now).toISOString(),stale:false};
  assert.equal(observation(state,now).fresh,true);assert.equal(observation(state,now+MAX_LIVE_SAMPLE_AGE_MS).fresh,true);assert.equal(observation(state,now+MAX_LIVE_SAMPLE_AGE_MS+1).fresh,false);
  for(const lastChecked of [undefined,null,123,'invalid',new Date(now+1).toISOString()])assert.equal(observation({...state,lastChecked},now).fresh,false);
  assert.equal(observation({...state,stale:true},now).fresh,false);assert.equal(observation(state,NaN).fresh,false);
});
test('cached online positions expire without another poll and remain explicitly display-only',async()=>{
  const x=setup();x.set(x.good());await x.status.poll();assert.equal(x.status.getState().online,true);assert.equal(x.saves.length,1);
  x.advance(120001);const live=x.status.getState();assert.equal(live.stale,true);assert.equal(live.online,false);assert.equal(live.characters.length,0);assert.equal(live.players.length,0);
  const display=x.status.getDisplayState();assert.equal(display.stale,true);assert.equal(display.characters.length,1);
  x.advance(15*60000);assert.equal(x.status.getDisplayState().characters.length,0);
});
test('successful cache refreshes cannot invent a new checked time or revive expired evidence',async()=>{
  const x=setup(),sample=x.good();x.set(sample);await x.status.poll();x.advance(120001);x.set({...sample,cached:true});await x.status.poll();
  const live=x.status.getState();assert.equal(live.lastChecked,sample.checkedAt);assert.equal(live.online,false);assert.equal(live.characters.length,0);assert.equal(x.saves.length,1);
  x.set(x.good());await x.status.poll();assert.equal(x.status.getState().online,true);assert.equal(x.saves.length,2);
});
test('missing, future and producer-stale snapshot times never enter live use or the saved fresh cache',async()=>{
  const x=setup();
  for(const patch of [{checkedAt:undefined},{checkedAt:'not-a-time'},{checkedAt:new Date(x.at()+1000).toISOString()},{stale:true}]){
    x.set({...x.good(),...patch});await x.status.poll();assert.equal(x.status.getState().online,false);assert.equal(x.status.getState().characters.length,0);
  }
  assert.equal(x.saves.length,0);
});
test('verified offline reports stay distinct from stale evidence, and fetch failure removes live positions',async()=>{
  const x=setup();x.set({...x.good(),online:false});await x.status.poll();assert.equal(x.status.getState().online,false);assert.equal(x.status.getState().stale,false);
  x.set(x.good());await x.status.poll();x.set(new Error('Synthetic source unavailable'));await x.status.poll();
  assert.equal(x.status.getState().stale,true);assert.equal(x.status.getState().characters.length,0);assert.equal(x.status.getDisplayState().stale,true);
});
