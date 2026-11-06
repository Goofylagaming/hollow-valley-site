'use strict';
const MAX_AGE_MS=180000;
// Passive authenticated bridge contact; this source never opens Discord or sends messages.
function createDiscordBridgeHealth({env=process.env,now=Date.now}={}){
 let signature=null,generation=0,sequence=0,lastSequence=0,observation=null;
 const pending=new WeakMap();
 const enabled=()=>env.STATUS_DISCORD_BRIDGE_HEALTH_ENABLED==='1';
 const configured=()=>Boolean(String(env.HERBYBOT_AUTOMATION_TOKEN||'').trim());
 const clock=()=>{const at=now();return Number.isSafeInteger(at)&&at>=0&&at<=8640000000000000?at:null;};
 function sync(){const next=JSON.stringify([env.STATUS_DISCORD_BRIDGE_HEALTH_ENABLED,env.HERBYBOT_AUTOMATION_TOKEN]);if(next!==signature){signature=next;generation++;observation=null;lastSequence=0;}}
 function begin(){sync();if(!enabled()||!configured())return null;const at=clock();if(at===null)return null;const token=Object.freeze({});pending.set(token,{generation,at,sequence:++sequence});return token;}
 function complete(token,ok){
  sync();const request=token&&pending.get(token);if(!request)return false;pending.delete(token);
  const at=clock();if(!enabled()||!configured()||request.generation!==generation||typeof ok!=='boolean'||at===null||request.at>at||request.sequence<=lastSequence)return false;
  lastSequence=request.sequence;observation={code:ok?'request-returned':'request-failed',at:request.at};return true;
 }
 function read(){
  sync();const base={version:1,scope:'authenticated-bot-bridge-contact',code:'not-configured',observedAt:null,gatewayVerified:false,deliveryVerified:false};
  if(!enabled())return base;if(!configured())return {...base,code:'bridge-not-configured'};if(!observation)return {...base,code:'no-observation'};
  const at=clock();if(at===null||at<observation.at)return {...base,code:'unverified-clock'};
  return {...base,code:at-observation.at>MAX_AGE_MS?'stale':observation.code,observedAt:new Date(observation.at).toISOString()};
 }
 return {begin,complete,read};
}
let service;function getDefaultService(){return service||(service=createDiscordBridgeHealth());}
function createRequestObserver({getService=getDefaultService}={}){
 return (req,res,next)=>{
  // Only existing polling routes; website health fetches cannot create contact.
  if(!((req.method==='GET'&&req.path==='/status')||(req.method==='POST'&&req.path==='/outbox/claim')))return next();
  try{
   const source=getService(),token=source.begin();
   if(token){let closed=false;res.once('close',()=>{closed=true;});res.once('finish',()=>{if(closed)return;try{source.complete(token,res.statusCode>=200&&res.statusCode<400);}catch{ /* Observation must not alter a bot response. */ }});}
  }catch{ /* Observation must not alter authentication, claiming or status reads. */ }
  next();
 };
}
module.exports={createDiscordBridgeHealth,getDefaultService,createRequestObserver,MAX_AGE_MS};
