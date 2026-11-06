'use strict';
const statuses=['queued','pending','started','scheduled','processing','succeeded','failed','completed','cancelled','confirmed','unknown','uncertain','published','acknowledged'];
function projectIncidentOperations(raw,query,{start,end,finished}){
 const stamp=value=>{const at=typeof value==='string'?Date.parse(value):NaN;return Number.isSafeInteger(at)&&at>=0&&new Date(at).toISOString()===value?at:null;};
 const sourceEnd=stamp(raw?.windowEnd);
 if(raw?.version!==1||raw.scope!=='retained-operation-records'||raw.steamId!==query.steamId||raw.occurredAt!==query.occurredAt||stamp(raw.windowStart)!==start||sourceEnd===null||sourceEnd<start||sourceEnd>Math.min(finished,Date.parse(query.occurredAt)+900000)||raw.complete!==false||raw.gameExecutionVerified!==false||raw.associations!=='current-stored-identities')throw Error('Unverified operation source');
 const output={};
 for(const [key,source]of [['audit','audit'],['requests','request']]){
  try{
   const section=raw[key];if(!section||typeof section.available!=='boolean'||typeof section.truncated!=='boolean'||!Array.isArray(section.events)||section.events.length>50||(!section.available&&section.events.length))throw Error('Invalid section');
   if(!section.available){output[key]=null;continue;}const seen=new Set(),events=[];
   for(const row of section.events){
    const at=stamp(row?.at);
    if(!row||typeof row.recordId!=='string'||!/^[A-Za-z0-9_.:-]{1,128}$/.test(row.recordId)||!['created','latest-update'].includes(row.marker)||row.id!==source+':'+row.recordId+':'+row.marker||seen.has(row.id)||at===null||at<start||at>sourceEnd||typeof row.category!=='string'||!/^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(row.category)||(source==='request'&&row.category!=='automation_request')||typeof row.operation!=='string'||!/^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(row.operation)||(row.marker==='created'?row.status!=='recorded':!statuses.includes(row.status))||!(source==='audit'?['actor','target','actor-and-target']:['player']).includes(row.selectedRole))throw Error('Invalid operation');
    seen.add(row.id);
    if(at<=end)events.push({source,id:row.id,at:row.at,category:row.category,action:(row.marker==='created'?'Record creation timestamp: ':'Latest recorded update: ')+row.operation,status:row.status,playerSteamId:query.steamId,reference:row.recordId,selectedRole:row.selectedRole,gameExecutionVerified:false,associations:'current-stored-identities'});
   }
   output[key]={events,truncated:section.truncated};
  }catch{output[key]=null;}
 }
 return output;
}
module.exports={projectIncidentOperations};
