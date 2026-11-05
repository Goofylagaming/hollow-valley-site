'use strict';
const MAX_AGE_MS=360000;
// Observe existing status reads only. This module owns no sockets or game actions.
function createRconHealth({env=process.env,now=Date.now}={}){
 let signature=null,generation=0,sequence=0,lastSequence=0,observation=null;
 const pending=new WeakMap();
 const enabled=()=>env.STATUS_RCON_HEALTH_ENABLED==='1';
 const disabled=()=>String(env.RCON_DISABLED||'').trim().toLowerCase()==='true';
 const configured=()=>['RCON_HOST','RCON_PORT','RCON_PASSWORD'].every(key=>Boolean(String(env[key]||'').trim()));
 const clock=()=>{const at=now();return Number.isSafeInteger(at)&&at>=0&&at<=8640000000000000?at:null;};
 function sync(){const next=JSON.stringify([env.STATUS_RCON_HEALTH_ENABLED,env.RCON_DISABLED,env.RCON_HOST,env.RCON_PORT,env.RCON_PASSWORD]);if(next!==signature){signature=next;generation++;observation=null;lastSequence=0;}}
 function begin(){sync();if(!enabled()||disabled()||!configured())return null;const at=clock();if(at===null)return null;const token=Object.freeze({});pending.set(token,{generation,at,sequence:++sequence});return token;}
 function complete(token,ok){
  sync();const request=token&&pending.get(token);if(!request)return false;pending.delete(token);
  const at=clock();if(!enabled()||disabled()||!configured()||request.generation!==generation||typeof ok!=='boolean'||at===null||request.at>at||request.sequence<=lastSequence)return false;
  lastSequence=request.sequence;observation={code:ok?'read-returned':'read-failed',at:request.at};return true;
 }
 function read(){
  sync();const base={version:1,scope:'automation-rcon-status-read',code:'not-configured',observedAt:null,commandExecutionVerified:false,playerDataVerified:false};
  if(!enabled())return base;if(disabled())return {...base,code:'rcon-disabled'};if(!configured())return {...base,code:'connection-not-configured'};if(!observation)return {...base,code:'no-observation'};
  const at=clock();if(at===null||at<observation.at)return {...base,code:'unverified-clock'};
  return {...base,code:at-observation.at>MAX_AGE_MS?'stale':observation.code,observedAt:new Date(observation.at).toISOString()};
 }
 return {begin,complete,read};
}
let service;function getDefaultService(){return service||(service=createRconHealth());}
module.exports={createRconHealth,getDefaultService,MAX_AGE_MS};
