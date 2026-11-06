'use strict';
const {sourceTime}=require('./sourceTimestamp');
const INTERVAL_MS=60000,MAX_AGE_MS=360000,TIMEOUT_MS=5000;
const SOURCE_CODES=new Set(['read-returned','read-failed','stale']);
const EMPTY_CODES=new Set(['not-configured','rcon-disabled','connection-not-configured','no-observation','unverified-clock']);
function createRconHealth({env=process.env,readSource=options=>require('./automationWebsiteClient').getRconHealth(options),now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,setLoop=setInterval,clearLoop=clearInterval}={}){
 let observation=null,accepted=null,lastAttempt=null,inFlight=null,loop=null,activeAbort=null,generation=0,configuration=null;
 const enabled=()=>env.STATUS_COMPONENTS_RCON_ENABLED==='1';
 const configured=()=>/^https?:\/\//i.test(String(env.AUTOMATION_SERVICE_URL||'').trim())&&Boolean(String(env.HOLLOW_VALLEY_API_TOKEN||'').trim());
 function syncConfiguration(){const key=JSON.stringify([env.STATUS_COMPONENTS_RCON_ENABLED,env.AUTOMATION_SERVICE_URL,env.HOLLOW_VALLEY_API_TOKEN]);if(key!==configuration){configuration=key;generation++;activeAbort?.abort();observation=null;accepted=null;lastAttempt=null;}}
 const frame=(code,at=null)=>({id:'rcon-read',scope:'automation-rcon-status-read',code,observedAt:at===null?null:new Date(at).toISOString(),commandExecutionVerified:false,playerDataVerified:false});
 function read(){
  syncConfiguration();if(!enabled())return frame('not-configured');if(!configured())return frame('integration-not-configured');if(!observation)return frame('no-observation');
  const clock=now();if(!Number.isSafeInteger(clock)||(observation.at!==null&&clock<observation.at)||clock<observation.receivedAt)return frame('unverified-clock');
  return frame((observation.at!==null&&clock-observation.at>MAX_AGE_MS)||clock-observation.receivedAt>MAX_AGE_MS?'stale':observation.code,observation.at);
 }
 function accept(raw,receivedAt){
  const invalid=()=>({code:'invalid-observation',at:null,receivedAt});
  if(raw?.available!==true||raw.version!==1||raw.scope!=='automation-rcon-status-read'||raw.commandExecutionVerified!==false||raw.playerDataVerified!==false)return invalid();
  if(EMPTY_CODES.has(raw.code))return raw.observedAt===null?{code:raw.code,at:null,receivedAt}:invalid();
  const at=sourceTime(raw.observedAt),clock=now();
  if(!SOURCE_CODES.has(raw.code)||at===null||!Number.isSafeInteger(clock)||at>clock)return invalid();
  if(raw.code==='stale'&&clock-at<=MAX_AGE_MS)return invalid();
  if(accepted&&(at<accepted.at||(at===accepted.at&&raw.code!==accepted.code&&raw.code!=='stale')))return invalid();
  if(accepted&&at===accepted.at)return {...accepted,code:raw.code};
  accepted={code:raw.code,at,receivedAt};return {...accepted};
 }
 function poll(){
  syncConfiguration();if(!enabled()||!configured())return Promise.resolve(read());if(inFlight)return inFlight;
  const at=now();if(!Number.isSafeInteger(at)||at<0||at>8640000000000000)return Promise.resolve(frame('unverified-clock'));
  if(lastAttempt!==null&&at-lastAttempt<INTERVAL_MS)return Promise.resolve(read());lastAttempt=at;
  const version=generation,abort=new AbortController();activeAbort=abort;let timer;
  const operation=(async()=>{
   let next;
   try{
    const deadline=new Promise((_,reject)=>{abort.signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true});timer=setTimer(()=>abort.abort(),TIMEOUT_MS);});
    const raw=await Promise.race([Promise.resolve().then(()=>readSource({signal:abort.signal})),deadline]);
    next=accept(raw,at);
   }catch(error){next={code:abort.signal.aborted||error?.code==='AUTOMATION_TIMEOUT'?'timed-out':'unavailable',at:null,receivedAt:at};}
   finally{if(timer!==undefined)clearTimer(timer);if(activeAbort===abort)activeAbort=null;}
   syncConfiguration();if(version===generation&&enabled()&&configured())observation=next;
   return read();
  })();
  inFlight=operation;operation.finally(()=>{if(inFlight===operation)inFlight=null;});return operation;
 }
 function stop(){generation++;activeAbort?.abort();if(loop!==null)clearLoop(loop);loop=null;observation=null;accepted=null;lastAttempt=null;}
 function start(){syncConfiguration();if(loop!==null||!enabled()||!configured())return stop;poll();loop=setLoop(()=>{poll();},INTERVAL_MS);loop?.unref?.();return stop;}
 return {read,poll,start,stop};
}
let service;function getDefaultService(){return service||(service=createRconHealth());}
module.exports={createRconHealth,getDefaultService,INTERVAL_MS,MAX_AGE_MS,TIMEOUT_MS};
