'use strict';
const {position}=require('./liveMapProjection');
const SPECIES=new Set(['tyrannosaurus','allosaurus','carnotaurus','ceratosaurus','deinosuchus','dilophosaurus','herrerasaurus','omniraptor','troodon','pteranodon','diabloceratops','dryosaurus','tenontosaurus','maiasaura','pachycephalosaurus','stegosaurus','triceratops','deinocheirus','gallimimus','hypsilophodon','beipiaosaurus']);
const stamp=value=>{const at=typeof value==='string'?Date.parse(value):NaN;return Number.isSafeInteger(at)&&at>=0&&new Date(at).toISOString()===value?at:null;};
const count=value=>Number.isSafeInteger(value)&&value>=0;
const steam=value=>typeof value==='string'&&/^\d{17}$/.test(value);
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
function projectSource(raw,clock){
 const readAt=stamp(raw?.readAt);
 if(raw?.version!==1||raw.scope!=='cached-admin-spectator'||readAt===null||readAt<86400000||readAt>clock||clock-readAt>30000)throw Error('Unverified source');
 const since=new Date(readAt-86400000).toISOString(),unavailable={available:false};
 function section(value,project){try{if(value?.available!==true||value.asOf!==raw.readAt||value.since!==undefined&&value.since!==since)throw Error('Unavailable');return {available:true,...project(value)};}catch{return {...unavailable};}}
 function observed(value,maxAge,project){
  const at=stamp(value?.observedAt);if(at===null||at>readAt)return {code:'unavailable',observedAt:null};
  if(clock-at>maxAge)return {code:'stale',observedAt:value.observedAt};
  if(value.code!=='fresh')return {code:'unavailable',observedAt:null};
  try{return {code:'fresh',observedAt:value.observedAt,expiresAt:new Date(at+maxAge).toISOString(),...project(value)};}catch{return {code:'unavailable',observedAt:null};}
 }
 const presence=observed(raw.presence,120000,value=>{
  if(!count(value.population)||!Array.isArray(value.observations)||value.observations.length>500||value.population!==value.observations.length)throw Error('Invalid population');
  const species=new Map(),regions=new Map();let unknownSpecies=0,unknownRegions=0;
  for(const observation of value.observations){
   if(!observation||observation.species!==null&&!SPECIES.has(observation.species))throw Error('Invalid species');
   if(observation.species===null)unknownSpecies++;else species.set(observation.species,(species.get(observation.species)||0)+1);
   const location=observation.location&&Number.isFinite(observation.location.x)&&Number.isFinite(observation.location.y)?observation.location:null;
   const region=position({location}).region;if(region)regions.set(region,(regions.get(region)||0)+1);else unknownRegions++;
  }
  const entries=map=>[...map].map(([label,count])=>({label,count})).sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label));
  return {population:value.population,species:entries(species),regions:entries(regions),unknownSpecies,unknownRegions,regionMethod:'nearest-map-label'};
 });
 const health=observed(raw.health,600000,value=>{if(typeof value.online!=='boolean')throw Error('Invalid health');return {online:value.online};});
 const bodyDrops=section(raw.bodyDrops,value=>{const counts={};for(const key of ['queued','acknowledged','unknown']){if(!count(value.counts?.[key]))throw Error('Invalid count');counts[key]=value.counts[key];}return {asOf:raw.readAt,counts};});
 const marketplace=section(raw.marketplace,value=>{if(value.since!==since||!count(value.failedOrders))throw Error('Invalid count');return {asOf:raw.readAt,since,failedOrders:value.failedOrders};});
 const errors=section(raw.errors,value=>{
  if(value.since!==since||typeof value.truncated!=='boolean'||!Array.isArray(value.items)||value.items.length>20)throw Error('Invalid errors');
  const seen=new Set(),items=value.items.map(row=>{const at=stamp(row?.at),id=row?.source+':'+row?.id;
   if(!['audit','request'].includes(row?.source)||typeof row.id!=='string'||!/^[A-Za-z0-9_.:-]{1,128}$/.test(row.id)||seen.has(id)||at===null||at<readAt-86400000||at>readAt||![row.category,row.operation].every(code=>typeof code==='string'&&/^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(code)))throw Error('Invalid error row');seen.add(id);return {id:row.id,source:row.source,at:row.at,category:row.category,operation:row.operation};});
  return {asOf:raw.readAt,since,truncated:value.truncated,items};
 });
 const combat=section(raw.combat,value=>{
  if(value.since!==since||value.notAnAbuseFinding!==true||typeof value.truncated!=='boolean'||!Array.isArray(value.pairs)||value.pairs.length>10)throw Error('Invalid pairs');
  const seen=new Set(),pairs=value.pairs.map(row=>{if(!steam(row?.attacker)||!steam(row.victim)||row.attacker===row.victim||!count(row.count)||row.count<2||seen.has(row.attacker+':'+row.victim))throw Error('Invalid pair');seen.add(row.attacker+':'+row.victim);return {attacker:row.attacker,victim:row.victim,count:row.count};});
  return {asOf:raw.readAt,since,truncated:value.truncated,pairs,notAnAbuseFinding:true};
 });
 return {readAt:raw.readAt,presence,health,bodyDrops,marketplace,errors,combat,fps:{available:false,reason:'not-recorded'}};
}
function createAdminSpectator({db,fetchSummary,enabled=()=>process.env.ADMIN_SPECTATOR_ENABLED==='1',now=Date.now}={}){
 function admin(getUser,binding){const user=getUser();if(!Number.isSafeInteger(user?.id)||user.id<=0||!steam(user?.steam_id))fail(403,'Current linked admin access is required.');const row=db.prepare('SELECT id,steam_id,is_admin FROM users WHERE id=?').get(user.id);if(!row?.is_admin||row.steam_id!==user.steam_id)fail(403,'Current linked admin access is required.');const actual=row.id+':'+row.steam_id;if(binding!==undefined&&binding!==actual)fail(403,'The admin account changed.');return actual;}
 function capabilities(getUser){return {enabled:Boolean(enabled()),reviewerBinding:admin(getUser),readOnly:true};}
 function battles(clock){try{
  const rows=db.prepare("SELECT id,event_id,status,declared_at,last_tick_at FROM territory_attacks WHERE status IN ('warning','active') AND resolved_at IS NULL ORDER BY id DESC LIMIT 21").all();let truncated=rows.length>20;const items=[];
  for(const row of rows.slice(0,20)){const value=row.last_tick_at||row.declared_at,at=stamp(value);if(!Number.isSafeInteger(row.id)||row.id<=0||!Number.isSafeInteger(row.event_id)||row.event_id<=0||at===null||at>clock){truncated=true;continue;}items.push({id:row.id,eventId:row.event_id,status:row.status,observedAt:value,stale:clock-at>120000});}
  return {available:true,asOf:new Date(clock).toISOString(),items,truncated,gameBattleVerified:false};
 }catch{return {available:false};}}
 async function read(getUser,binding){
  const actor=admin(getUser,binding);if(binding!==actor)fail(403,'Reload for the current admin account.');if(!enabled())fail(503,'Spectator summary is disabled.');
  const started=now();if(!Number.isSafeInteger(started)||started<86400000||started>8640000000000000-600000)fail(503,'Summary clock is unavailable.');
  let raw;try{raw=await fetchSummary();}catch{}
  admin(getUser,actor);if(!enabled())fail(503,'Spectator summary is disabled.');const finished=now();if(!Number.isSafeInteger(finished)||finished<started||finished>8640000000000000-600000)fail(503,'Summary clock is unavailable.');
  let source;try{source=projectSource(raw,finished);}catch{source={readAt:null,presence:{code:'unavailable',observedAt:null},health:{code:'unavailable',observedAt:null},bodyDrops:{available:false},marketplace:{available:false},errors:{available:false},combat:{available:false},fps:{available:false,reason:'not-recorded'}};}
  return {version:1,reviewerBinding:actor,readOnly:true,fetchedAt:new Date(finished).toISOString(),...source,battles:battles(finished)};
 }
 return {capabilities,read};
}
let service;function getDefaultService(){return service||=createAdminSpectator({db:require('../db').db,fetchSummary:()=>require('./automationWebsiteClient').getAdminSpectatorSummary()});}
module.exports={createAdminSpectator,projectSource,getDefaultService};
