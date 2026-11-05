'use strict';
const {createHash}=require('node:crypto');
const WINDOW_MS=15*60*1000,LIMIT=50,CHAT_LIMIT=500;
const id=value=>typeof value==='string'&&/^\d{17}$/.test(value);
function timestamp(value){if(typeof value!=='string')return null;const at=Date.parse(value);return Number.isSafeInteger(at)&&at>=0&&new Date(at).toISOString()===value?at:null;}
function createReportContextSource({combatDb,readChat,now=Date.now,enabled=()=>process.env.PLAYER_REPORT_CONTEXT_ENABLED==='1',source=()=>String(process.env.COMBAT_FEED_SOURCE||'hollow-valley-game').trim()}={}){
 function read(input){
  if(!enabled())throw Object.assign(Error('Report context is disabled'),{status:503});
  const clock=now(),at=timestamp(input?.occurredAt),reporter=input?.reporterSteamId,reported=input?.reportedSteamId||null;
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['occurredAt','reporterSteamId','reportedSteamId'].includes(k))||!id(reporter)||(reported!==null&&(!id(reported)||reported===reporter))||at===null||!Number.isSafeInteger(clock)||clock<0||clock>8640000000000000||at<clock-90*86400000||at>clock+WINDOW_MS)throw Object.assign(Error('A report participant and recorded approximate time are required'),{status:400});
  const start=at-WINDOW_MS,end=Math.min(clock,at+WINDOW_MS),from=new Date(start).toISOString(),until=new Date(end).toISOString(),participants=[reporter,...(reported?[reported]:[])];
  const role=steam=>steam===reporter?'reporter':reported!==null&&steam===reported?'reported':null;
  const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(value);
  let combat={available:false,truncated:false,events:[]},chat={available:false,truncated:false,messages:[]};
  try{
   const origin=source();if(!/^[A-Za-z0-9_.:-]{2,80}$/.test(origin))throw Error('Source unavailable');
   const slots=participants.map(()=>'?').join(',');
   const rows=combatDb.prepare(`SELECT id,occurred_at,killer_steam_id,victim_steam_id FROM combat_events
    WHERE source=? AND (killer_steam_id IN (${slots}) OR victim_steam_id IN (${slots}))
    AND julianday(occurred_at)>=julianday(?) AND julianday(occurred_at)<=julianday(?)
    ORDER BY julianday(occurred_at) DESC,id DESC LIMIT ?`).all(origin,...participants,...participants,from,until,LIMIT+1);
   combat={available:true,truncated:rows.length>LIMIT,events:[]};
   for(const row of rows.slice(0,LIMIT)){
    const eventAt=timestamp(row.occurred_at);if(!safeId(row.id)||eventAt===null||eventAt<start||eventAt>end){combat.truncated=true;continue;}
    const attacker=role(row.killer_steam_id),victim=role(row.victim_steam_id);if(!attacker&&!victim){combat.truncated=true;continue;}
    combat.events.push({id:row.id,at:row.occurred_at,attacker,victim,otherPlayerIdentityWithheld:true});
   }
  }catch{ /* Missing or failed sources remain unavailable, without raw errors. */ }
  try{
   const result=readChat();if(!Array.isArray(result?.messages)||result.messages.length>CHAT_LIMIT)throw Error('Chat unavailable');
   const matches=[];
   for(const row of result.messages){
    const participant=role(row?.steamId),eventAt=timestamp(row?.at);if(!participant||eventAt===null||eventAt<start||eventAt>end)continue;
    if(!safeId(row.id)||typeof row.message!=='string'||row.message.length>500){chat.truncated=true;continue;}
    const original=row.message;
    const text=original.replace(/[\x00-\x1f\x7f]/g,' ').replace(/(bearer\s+)[^\s]+/gi,'$1[redacted]').replace(/\b(password|token|secret|authorization)\s*[:=]\s*\S+/gi,'$1=[redacted]');
    matches.push({id:row.id,at:row.at,participant,channel:['global','local'].includes(row.channel)?row.channel:'unknown',text,redacted:text!==original,digest:createHash('sha256').update(original).digest('hex')});
   }
   matches.sort((a,b)=>b.at.localeCompare(a.at)||b.id.localeCompare(a.id));chat={available:true,truncated:chat.truncated||matches.length>LIMIT,messages:matches.slice(0,LIMIT)};
  }catch{ /* A failed chat source must not hide available combat context. */ }
  return {reportedTime:input.occurredAt,windowStart:from,windowEnd:until,associationOnly:true,complete:false,retainedChatLimit:CHAT_LIMIT,combat,chat};
 }
 return {read};
}
module.exports={createReportContextSource,WINDOW_MS,LIMIT,CHAT_LIMIT};
