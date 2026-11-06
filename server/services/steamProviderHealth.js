'use strict';
// Read-only provider discovery. Never send an identity, login request or API key.
const ENDPOINT='https://steamcommunity.com/openid/';
const INTERVAL_MS=60000,MAX_AGE_MS=180000,TIMEOUT_MS=5000;
function createSteamProviderHealth({env=process.env,fetchImpl=(...args)=>fetch(...args),now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,setLoop=setInterval,clearLoop=clearInterval}={}){
 let observation=null,inFlight=null,lastAttempt=null,loop=null,generation=0,activeAbort=null;
 const enabled=()=>env.STATUS_COMPONENTS_STEAM_ENABLED==='1';
 const configured=()=>Boolean(env.STEAM_RETURN_URL&&env.STEAM_REALM);
 const frame=(code,at=null)=>({id:'steam-openid',scope:'provider-discovery-http',code,observedAt:at===null?null:new Date(at).toISOString(),linkingVerified:false});
 function read(){
  if(!enabled())return frame('not-configured');
  if(!configured())return frame('login-not-configured');
  if(!observation)return frame('no-observation');
  const clock=now();if(!Number.isSafeInteger(clock)||clock<observation.at)return frame('unverified-clock');
  return frame(clock-observation.at>MAX_AGE_MS?'stale':observation.code,observation.at);
 }
 function poll(){
  if(!enabled()||!configured())return Promise.resolve(read());
  if(inFlight)return inFlight;
  const at=now();if(!Number.isSafeInteger(at)||at<0)return Promise.resolve(frame('unverified-clock'));
  if(lastAttempt!==null&&at-lastAttempt<INTERVAL_MS)return Promise.resolve(read());
  lastAttempt=at;const version=generation,abort=new AbortController();activeAbort=abort;let timer;
  const operation=(async()=>{
   let code='unavailable';
   try{
    const timeout=new Promise((_,reject)=>{abort.signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true});timer=setTimer(()=>abort.abort(),TIMEOUT_MS);});
    const request=Promise.resolve().then(()=>fetchImpl(ENDPOINT,{method:'GET',redirect:'manual',credentials:'omit',cache:'no-store',headers:{Accept:'application/xrds+xml'},signal:abort.signal})).then(response=>{
     // Consume no provider document or private error body; cancel after headers.
     try{Promise.resolve(response.body?.cancel()).catch(()=>{});}catch{}
     return response;
    });
    const response=await Promise.race([request,timeout]);
    const type=String(response.headers?.get('content-type')||'').split(';')[0].trim().toLowerCase();
    code=response.status===200&&type==='application/xrds+xml'?'responded':'unexpected-response';
   }catch{code=abort.signal.aborted?'timed-out':'unavailable';}
   finally{if(timer!==undefined)clearTimer(timer);if(activeAbort===abort)activeAbort=null;}
   // A stop or configuration withdrawal cannot publish a late observation.
   if(version===generation&&enabled()&&configured())observation={code,at};
   return read();
  })();
  inFlight=operation;operation.finally(()=>{if(inFlight===operation)inFlight=null;});return operation;
 }
 function stop(){generation++;activeAbort?.abort();if(loop!==null)clearLoop(loop);loop=null;observation=null;lastAttempt=null;}
 function start(){if(loop!==null||!enabled()||!configured())return stop;poll();loop=setLoop(()=>{poll();},INTERVAL_MS);loop?.unref?.();return stop;}
 return {read,poll,start,stop};
}
let service;function getDefaultService(){return service||(service=createSteamProviderHealth());}
module.exports={createSteamProviderHealth,getDefaultService,ENDPOINT,INTERVAL_MS,MAX_AGE_MS,TIMEOUT_MS};
