'use strict';
const {createHash}=require('node:crypto');
const WINDOW_MS=900000,LIMIT=50;
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const stamp=value=>{const at=typeof value==='string'?Date.parse(value):NaN;return Number.isSafeInteger(at)&&at>=0&&new Date(at).toISOString()===value?at:null;};
const steam=value=>typeof value==='string'&&/^\d{17}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const mask=text=>text.replace(/[\x00-\x1f\x7f]/g,' ').replace(/(bearer\s+)[^\s]+/gi,'$1[redacted]').replace(/\b(password|token|secret|authorization)\s*[:=]\s*\S+/gi,'$1=[redacted]');
function project(raw,report,clock){
 const bad=()=>fail(502,'Report context could not be verified.');
 const center=stamp(report.occurred_at),start=stamp(raw?.windowStart),end=stamp(raw?.windowEnd);
 if(raw?.version!==1||raw.scope!=='report-participant-context'||raw.reportedTime!==report.occurred_at||raw.associationOnly!==true||raw.complete!==false||raw.retainedChatLimit!==500||start!==center-WINDOW_MS||end===null||end<start||end>Math.min(clock,center+WINDOW_MS))bad();
 const sourceId=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(value);
 const role=value=>value===null||value==='reporter'||(value==='reported'&&Boolean(report.reported_steam_id));
 const when=value=>{const at=stamp(value);if(at===null||at<start||at>end)bad();return value;};
 const shape=(value,key)=>{if(!value||typeof value.available!=='boolean'||typeof value.truncated!=='boolean'||!Array.isArray(value[key])||value[key].length>LIMIT||(!value.available&&value[key].length))bad();const seen=new Set();for(const row of value[key]){if(!sourceId(row?.id)||seen.has(row.id))bad();seen.add(row.id);}return {available:value.available,truncated:value.truncated};};
 const combat={...shape(raw.combat,'events'),events:raw.combat.events.map(row=>{if(!role(row.attacker)||!role(row.victim)||(!row.attacker&&!row.victim)||row.otherPlayerIdentityWithheld!==true)bad();return {id:row.id,at:when(row.at),attacker:row.attacker,victim:row.victim,otherPlayerIdentityWithheld:true};})};
 const chat={...shape(raw.chat,'messages'),messages:raw.chat.messages.map(row=>{
  if(!['reporter','reported'].includes(row.participant)||(row.participant==='reported'&&!report.reported_steam_id)||!['global','local','unknown'].includes(row.channel)||typeof row.text!=='string'||row.text.length>500||typeof row.redacted!=='boolean'||typeof row.digest!=='string'||!/^[a-f0-9]{64}$/.test(row.digest))bad();
  if(!row.redacted&&createHash('sha256').update(row.text).digest('hex')!==row.digest)bad();
  const text=mask(row.text);return {id:row.id,at:when(row.at),participant:row.participant,channel:row.channel,text,redacted:row.redacted||text!==row.text,digest:row.digest};
 })};
 return {version:1,scope:'report-participant-context',reportedTime:report.occurred_at,windowStart:raw.windowStart,windowEnd:raw.windowEnd,associationOnly:true,complete:false,retainedChatLimit:500,combat,chat};
}
function createReportContextReader({db,fetchContext,snapshots=null,enabled=()=>process.env.PLAYER_REPORT_CONTEXT_ENABLED==='1',now=Date.now}={}){
 function admin(user){
  if(!Number.isSafeInteger(user?.id)||!steam(user?.steam_id))fail(403,'Current linked admin access is required.');
  const current=db.prepare('SELECT id,steam_id,is_admin FROM users WHERE id=?').get(user.id);
  if(!current?.is_admin||current.steam_id!==user.steam_id)fail(403,'Current linked admin access is required.');return {id:current.id,steamId:current.steam_id,binding:current.id+':'+current.steam_id};
 }
 function report(id){if(!uuid(id))fail(400,'Invalid report reference.');const row=db.prepare('SELECT id,reporter_steam_id,reported_steam_id,occurred_at FROM player_reports WHERE id=?').get(id);if(!row)fail(404,'Report not found.');return row;}
 function capabilities(getUser){const actor=admin(getUser());return {enabled:Boolean(enabled()),reviewerBinding:actor.binding,associationOnly:true,...(snapshots?snapshots.capabilities(getUser,actor.binding):{})};}
 async function read(getUser,id,expectedBinding){
  const actor=admin(getUser());if(expectedBinding!==actor.binding)fail(403,'Reload reports for the current admin account.');
  if(!enabled())fail(503,'Report context is not enabled.');const saved=report(id),at=stamp(saved.occurred_at),clock=now();
  if(!steam(saved.reporter_steam_id)||(saved.reported_steam_id!==null&&(!steam(saved.reported_steam_id)||saved.reported_steam_id===saved.reporter_steam_id)))fail(409,'The saved report participants cannot be verified.');
  if(at===null)return {available:false,reason:'time-required',reportId:id,reviewerBinding:actor.binding};
  if(!Number.isSafeInteger(clock)||clock<0||at<clock-90*86400000||at>clock+WINDOW_MS)return {available:false,reason:'time-outside-source-window',reportId:id,reviewerBinding:actor.binding};
  let raw,failed=false;try{raw=await fetchContext({reporterSteamId:saved.reporter_steam_id,reportedSteamId:saved.reported_steam_id,occurredAt:saved.occurred_at});}catch{failed=true;}
  const current=admin(getUser());if(current.binding!==actor.binding)fail(403,'The admin account changed. Reload reports.');if(!enabled())fail(503,'Report context is not enabled.');
  if(JSON.stringify(report(id))!==JSON.stringify(saved))fail(409,'The saved report context changed. Reload reports.');
  if(failed)fail(502,'Recorded context is temporarily unavailable.');const finished=now();if(!Number.isSafeInteger(finished)||finished<clock)fail(502,'The context observation time cannot be verified.');
  const context=project(raw,saved,finished);
  return {available:true,reportId:id,reviewerBinding:actor.binding,context,...(snapshots?{review:snapshots.offer(getUser,id,actor.binding,context)}:{})};
 }
 return {read,capabilities};
}
let reader;function getDefaultReader(){return reader||(reader=createReportContextReader({db:require('../db').db,snapshots:require('./reportContextSnapshots').getDefaultStore(),fetchContext:args=>require('./automationWebsiteClient').getAdminReportContext(args)}));}
module.exports={createReportContextReader,project,getDefaultReader};
