'use strict';
const {timestamp}=require('./incidentMarketplaceService');
const WINDOW_MS=900000,LIMIT=50;
const statuses=['queued','pending','started','scheduled','processing','succeeded','failed','completed','cancelled','confirmed','unknown','uncertain','published','acknowledged'];
const code=value=>typeof value==='string'&&/^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(value)?value:'unknown';
function createIncidentOperationsSource({db,now=Date.now,enabled=()=>process.env.INCIDENT_OPERATIONS_HISTORY_ENABLED==='1'}={}){
 function read(input){
  const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
  if(!enabled())fail(503,'Retained operation context is disabled.');
  const clock=now(),at=timestamp(input?.occurredAt);
  if(!input||Array.isArray(input)||Object.keys(input).some(key=>!['steamId','occurredAt'].includes(key))||typeof input.steamId!=='string'||!/^\d{17}$/.test(input.steamId)||at===null||input.occurredAt!==new Date(at).toISOString()||!Number.isSafeInteger(clock)||clock<WINDOW_MS||clock>8640000000000000-WINDOW_MS||at<WINDOW_MS||at<clock-90*86400000||at>clock+WINDOW_MS)fail(400,'A player and valid incident time are required.');
  const start=at-WINDOW_MS,end=Math.min(clock,at+WINDOW_MS),from=new Date(start).toISOString(),until=new Date(end).toISOString(),steam=input.steamId;
  function project(rows,source){
   let truncated=rows.length>LIMIT;const events=[];
   for(const row of rows.slice(0,LIMIT)){
    const eventAt=timestamp(row.at);
    if(typeof row.id!=='string'||!/^[A-Za-z0-9_.:-]{1,128}$/.test(row.id)||eventAt===null||eventAt<start||eventAt>end){truncated=true;continue;}
    events.push({id:source+':'+row.id+':'+row.marker,recordId:row.id,at:new Date(eventAt).toISOString(),marker:row.marker,category:source==='audit'?code(row.category):'automation_request',operation:code(row.operation),status:row.marker==='created'?'recorded':statuses.includes(row.status)?row.status:'unknown',selectedRole:row.role});
   }
   return {available:true,truncated,events};
  }
  let audit={available:false,truncated:false,events:[]},requests={available:false,truncated:false,events:[]};
  try{
   const rows=db.prepare(`WITH safe AS (
    SELECT id,category,action,status,created_at,updated_at,
     CASE WHEN length(CAST(details_json AS BLOB))<=16384 THEN CASE WHEN json_valid(details_json) THEN details_json ELSE '{}' END ELSE '{}' END AS details
    FROM automation_audit WHERE (julianday(created_at) BETWEEN julianday(?) AND julianday(?)) OR (julianday(updated_at) BETWEEN julianday(?) AND julianday(?))
   ), matches AS (
    SELECT *, ((json_type(details,'$.actorSteamId')='text' AND json_extract(details,'$.actorSteamId')=?) OR (json_type(details,'$.adminSteamId')='text' AND json_extract(details,'$.adminSteamId')=?)) AS actor_match,
    ((json_type(details,'$.targetSteamId')='text' AND json_extract(details,'$.targetSteamId')=?) OR (json_type(details,'$.steamId')='text' AND json_extract(details,'$.steamId')=?) OR (json_type(details,'$.playerSteamId')='text' AND json_extract(details,'$.playerSteamId')=?)) AS target_match FROM safe
   ), selected AS (
    SELECT *,CASE WHEN actor_match AND target_match THEN 'actor-and-target' WHEN actor_match THEN 'actor' ELSE 'target' END AS role FROM matches WHERE actor_match OR target_match
   ) SELECT * FROM (
    SELECT id,category,action AS operation,created_at AS at,'created' AS marker,'recorded' AS status,role FROM selected WHERE julianday(created_at) BETWEEN julianday(?) AND julianday(?)
    UNION ALL
    SELECT id,category,action,updated_at,'latest-update',status,role FROM selected WHERE julianday(updated_at) BETWEEN julianday(?) AND julianday(?)
   ) ORDER BY julianday(at) DESC,id DESC,marker DESC LIMIT ?`).all(from,until,from,until,steam,steam,steam,steam,steam,from,until,from,until,LIMIT+1);
   audit=project(rows,'audit');
  }catch{ /* Missing/malformed source is independent of requests. */ }
  try{
   const rows=db.prepare(`SELECT * FROM (
    SELECT id,kind AS operation,created_at AS at,'created' AS marker,'recorded' AS status,'player' AS role FROM automation_requests WHERE steam_id=? AND julianday(created_at) BETWEEN julianday(?) AND julianday(?)
    UNION ALL
    SELECT id,kind,updated_at,'latest-update',status,'player' FROM automation_requests WHERE steam_id=? AND julianday(updated_at) BETWEEN julianday(?) AND julianday(?)
   ) ORDER BY julianday(at) DESC,id DESC,marker DESC LIMIT ?`).all(steam,from,until,steam,from,until,LIMIT+1);
   requests=project(rows,'request');
  }catch{ /* No fallback to an unrelated recent global window. */ }
  return {version:1,scope:'retained-operation-records',steamId:steam,occurredAt:input.occurredAt,windowStart:from,windowEnd:until,complete:false,gameExecutionVerified:false,associations:'current-stored-identities',audit,requests};
 }
 return {read};
}
module.exports={createIncidentOperationsSource,LIMIT};
