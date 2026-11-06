'use strict';
const {canonicalCombatSpecies}=require('../config/combatSpecies');
const {timestamp}=require('./incidentMarketplaceService');
const PRESENCE_MAX_AGE=120000,HEALTH_MAX_AGE=600000,MAX_BYTES=1024*1024;
const steam=value=>typeof value==='string'&&/^\d{17}$/.test(value);
const code=value=>typeof value==='string'&&/^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(value)?value:'unknown';
function createAdminSpectatorSource({db,now=Date.now,enabled=()=>process.env.ADMIN_SPECTATOR_ENABLED==='1',combatSource=()=>String(process.env.COMBAT_FEED_SOURCE||'hollow-valley-game').trim()}={}){
 function read(input={}){
  if(!enabled())throw Object.assign(Error('Spectator summary is disabled.'),{status:503});
  if(!input||Array.isArray(input)||Object.keys(input).length)throw Object.assign(Error('Summary queries do not accept overrides.'),{status:400});
  const clock=now();if(!Number.isSafeInteger(clock)||clock<86400000||clock>8640000000000000-HEALTH_MAX_AGE)throw Error('Unverified clock');
  const asOf=new Date(clock).toISOString(),since=new Date(clock-86400000).toISOString();
  const age=(value,max)=>{const at=timestamp(value);if(at===null||at>clock)return {code:'unverified-clock',observedAt:null};return {code:clock-at>max?'stale':'fresh',observedAt:new Date(at).toISOString()};};
  let presence={code:'unavailable',observedAt:null},health={code:'unavailable',observedAt:null},bodyDrops={available:false},marketplace={available:false},errors={available:false},combat={available:false};
  try{
   const row=db.prepare('SELECT sampled_at,length(CAST(snapshot_json AS BLOB)) bytes,substr(snapshot_json,1,?) payload FROM external_server_snapshot WHERE id=1').get(MAX_BYTES+1);
   if(row){presence=age(row.sampled_at,PRESENCE_MAX_AGE);if(presence.code==='fresh'){
    if(!Number.isSafeInteger(row.bytes)||row.bytes>MAX_BYTES)throw Error('Oversized');const raw=JSON.parse(row.payload);
    if(raw?.online!==true||!Array.isArray(raw.players)||!Array.isArray(raw.characters)||raw.players.length>500||raw.characters.length!==raw.players.length)throw Error('Invalid roster');
    const ids=new Set();for(const player of raw.players){if(!steam(player?.steamId)||ids.has(player.steamId))throw Error('Invalid identity');ids.add(player.steamId);}
    const seen=new Set(),observations=[];for(const player of raw.characters){if(!steam(player?.steamId)||!ids.has(player.steamId)||seen.has(player.steamId))throw Error('Roster mismatch');seen.add(player.steamId);
     const location=player.location&&typeof player.location==='object'&&!Array.isArray(player.location)&&Number.isFinite(player.location.x)&&Number.isFinite(player.location.y)?{x:player.location.x,y:player.location.y}:null;
     observations.push({species:canonicalCombatSpecies(player.species),location});
    }
    presence={...presence,population:observations.length,observations};
   }}
  }catch{presence={code:'unavailable',observedAt:null};}
  try{
   const row=db.prepare('SELECT checked_at,online FROM server_health_samples ORDER BY julianday(checked_at) DESC,id DESC LIMIT 1').get();
   if(row){health=age(row.checked_at,HEALTH_MAX_AGE);if(health.code==='fresh'){if(![0,1].includes(row.online))throw Error('Invalid state');health={...health,online:row.online===1};}}
  }catch{health={code:'unavailable',observedAt:null};}
  try{
   const rows=db.prepare("SELECT status,COUNT(*) count FROM automation_requests WHERE kind='bodydrop' AND status IN ('queued','acknowledged','unknown') GROUP BY status").all(),counts={queued:0,acknowledged:0,unknown:0};
   for(const row of rows){if(!Number.isSafeInteger(row.count)||row.count<0)throw Error('Invalid count');counts[row.status]=row.count;}bodyDrops={available:true,asOf,counts};
  }catch{}
  try{
   const row=db.prepare("SELECT COUNT(*) count FROM economy_marketplace_orders WHERE status='failed' AND julianday(updated_at) BETWEEN julianday(?) AND julianday(?)").get(since,asOf);
   if(!Number.isSafeInteger(row.count)||row.count<0)throw Error('Invalid count');marketplace={available:true,asOf,since,failedOrders:row.count};
  }catch{}
  try{
   const rows=db.prepare(`SELECT * FROM (
    SELECT id,'audit' source,category,action operation,updated_at at FROM automation_audit WHERE status='failed' AND julianday(updated_at) BETWEEN julianday(?) AND julianday(?)
    UNION ALL
    SELECT id,'request','automation_request',kind,updated_at FROM automation_requests WHERE status='failed' AND julianday(updated_at) BETWEEN julianday(?) AND julianday(?)
   ) ORDER BY julianday(at) DESC,id DESC LIMIT 21`).all(since,asOf,since,asOf);
   const items=[];let truncated=rows.length>20;
   for(const row of rows.slice(0,20)){const at=timestamp(row.at);if(typeof row.id!=='string'||!/^[A-Za-z0-9_.:-]{1,128}$/.test(row.id)||at===null){truncated=true;continue;}items.push({id:row.id,source:row.source,category:code(row.category),operation:code(row.operation),at:new Date(at).toISOString()});}
   errors={available:true,asOf,since,truncated,items};
  }catch{}
  try{
   const source=combatSource();if(!/^[A-Za-z0-9_.:-]{2,80}$/.test(source))throw Error('Invalid source');
   const rows=db.prepare(`SELECT killer_steam_id attacker,victim_steam_id victim,COUNT(DISTINCT julianday(occurred_at)) count,MAX(julianday(occurred_at)) latest
    FROM combat_events WHERE source=? AND killer_steam_id IS NOT NULL AND killer_steam_id<>victim_steam_id AND julianday(occurred_at) BETWEEN julianday(?) AND julianday(?)
    GROUP BY killer_steam_id,victim_steam_id HAVING COUNT(DISTINCT julianday(occurred_at))>=2 ORDER BY count DESC,latest DESC,attacker,victim LIMIT 11`).all(source,since,asOf);
   const pairs=[];let truncated=rows.length>10;
   for(const row of rows.slice(0,10)){if(!steam(row.attacker)||!steam(row.victim)||!Number.isSafeInteger(row.count)||row.count<2){truncated=true;continue;}pairs.push({attacker:row.attacker,victim:row.victim,count:row.count});}
   combat={available:true,asOf,since,truncated,pairs,notAnAbuseFinding:true};
  }catch{}
  return {version:1,scope:'cached-admin-spectator',readAt:asOf,presence,health,fps:{available:false,reason:'not-recorded'},bodyDrops,marketplace,errors,combat};
 }
 return {read};
}
module.exports={createAdminSpectatorSource,PRESENCE_MAX_AGE,HEALTH_MAX_AGE};
