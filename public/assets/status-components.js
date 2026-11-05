(() => {
 'use strict';
 const $=id=>document.getElementById('status-worker-'+id),MAX_AGE=90000;
 const messages={
  running:['ok','Observed running','The management agent last recorded the worker task as running. Command delivery and in-game execution are not checked.'],
  'not-running':['attention','Not running at last check','The management agent last recorded the worker task as ready, disabled or missing. This is a task observation, not a game-server verdict.'],
  queued:['delayed','Queued at last check','The worker task was queued when the agent checked it. Execution is not verified.'],
  'unknown-state':['unknown','Unknown','The agent did not report a usable running state for the worker task.'],
  stale:['delayed','Delayed','The recorded worker observation has expired. Current task state is unverified.'],
  'not-configured':['unknown','Not monitored','The independent worker observation is not enabled or configured.'],
  'no-observation':['unknown','No observation','No timestamped worker observation has been received.'],
  'unverified-clock':['unknown','Clock unverified','The worker observation time cannot be verified. Current task state is unknown.'],
  unavailable:['unknown','Unknown','The worker observation could not be verified. Refresh to try again.'],
 };

 const mapMessages={
  usable:['ok','Position source usable','The cached source contains projectable positions. Individual account access and map rendering are not checked.'],
  unprojectable:['attention','Positions unavailable','The source includes missing or out-of-bounds positions. Current map markers cannot all be verified.'],
  'no-position-observation':['unknown','No position observation','No characters are available to check. Map projection is unverified.'],
  'verified-offline':['attention','Game reported offline','The timestamped source reported the game offline. Map rendering is not checked.'],
  stale:['delayed','Delayed','The map source has expired. Current positions are unverified.'],
  'not-configured':['unknown','Not monitored','The map source observation is not enabled or configured.'],
  'unverified-clock':['unknown','Clock unverified','The map source time cannot be verified.'],
  unavailable:['unknown','Unknown','The map source could not be verified. Refresh to try again.']
 };
 function renderMap(value){
  const card=document.getElementById('status-map-card');if(!card)return;
  let code='unavailable',at=null;
  if(value?.scope==='cached-position-source'&&value.renderingVerified===false&&Object.hasOwn(mapMessages,value.code)){
   code=value.code;
   if(value.observedAt!==null){at=Date.parse(value.observedAt);if(typeof value.observedAt!=='string'||!Number.isSafeInteger(at)||at<0||new Date(at).toISOString()!==value.observedAt){code='unavailable';at=null;}}
   if(!['not-configured','unverified-clock','unavailable'].includes(code)&&at===null)code='unavailable';
   if(at!==null)code=at>Date.now()?'unverified-clock':Date.now()-at>120000?'stale':code;
  }
  const [state,label,detail]=mapMessages[code];card.dataset.state=state;
  document.getElementById('status-map-state').textContent=label;document.getElementById('status-map-detail').textContent=detail;
  document.getElementById('status-map-time').textContent=at!==null?'Source snapshot: '+new Date(at).toLocaleString('en-AU',{timeZone:'Australia/Brisbane',dateStyle:'medium',timeStyle:'short'})+' AEST':'No verified map source observation yet';
 }
 const steamMessages={
  responded:['ok','Provider endpoint responded','Steam returned a discovery response. Signing in, linking accounts and profile retrieval are not verified.'],
  'unexpected-response':['attention','Unexpected provider response','The last check did not receive the expected discovery response. Account linking remains unverified.'],
  'timed-out':['delayed','Provider check timed out','The endpoint did not answer within the check window. This does not prove an account cannot sign in.'],
  stale:['delayed','Delayed','The provider observation has expired. Current endpoint reachability is unknown.'],
  'not-configured':['unknown','Not monitored','The Steam provider check is not enabled.'],
  'login-not-configured':['unknown','Sign-in not configured','This website has not configured Steam sign-in.'],
  'no-observation':['unknown','No observation','No provider check has finished in this website process yet.'],
  'unverified-clock':['unknown','Clock unverified','The provider observation time cannot be verified.'],
  unavailable:['unknown','Unknown','The provider endpoint could not be checked. Account linking is unverified.']
 };
 function renderSteam(value){
  const card=document.getElementById('status-steam-card');if(!card)return;
  let code='unavailable',at=null;
  if(value?.scope==='provider-discovery-http'&&value.linkingVerified===false&&Object.hasOwn(steamMessages,value.code)){
   code=value.code;
   if(value.observedAt!==null){at=Date.parse(value.observedAt);if(typeof value.observedAt!=='string'||!Number.isSafeInteger(at)||at<0||new Date(at).toISOString()!==value.observedAt){code='unavailable';at=null;}}
   if(!['not-configured','login-not-configured','no-observation','unverified-clock','unavailable'].includes(code)&&at===null)code='unavailable';
   if(at!==null)code=at>Date.now()?'unverified-clock':Date.now()-at>180000?'stale':code;
  }
  const [state,label,detail]=steamMessages[code];card.dataset.state=state;
  document.getElementById('status-steam-state').textContent=label;document.getElementById('status-steam-detail').textContent=detail;
  document.getElementById('status-steam-time').textContent=at!==null?'Source snapshot: '+new Date(at).toLocaleString('en-AU',{timeZone:'Australia/Brisbane',dateStyle:'medium',timeStyle:'short'})+' AEST':'No verified provider observation yet';
 }
 let controller=null,generation=0;
 function show(code,at=null){const [state,label,detail]=messages[code]||messages.unavailable;document.getElementById('status-worker-card').dataset.state=state;$('state').textContent=label;$('detail').textContent=detail;$('time').textContent=at?'Agent snapshot: '+new Date(at).toLocaleString('en-AU',{timeZone:'Australia/Brisbane',dateStyle:'medium',timeStyle:'short'})+' AEST':'No verified worker observation yet';}
 function renderWorker(value){
   if(value?.id!=='bridge-worker'||value.scope!=='windows-scheduled-task'||value.executionVerified!==false||!Object.hasOwn(messages,value.code))return show('unavailable');
   let at=null;if(value.observedAt!==null){at=Date.parse(value.observedAt);if(typeof value.observedAt!=='string'||!Number.isSafeInteger(at)||at<0||new Date(at).toISOString()!==value.observedAt)return show('unavailable');}
   if(['running','not-running','queued','unknown-state','stale'].includes(value.code)&&at===null)return show('unavailable');
   if(at!==null&&at>Date.now()){show('unverified-clock');return;}
   show(at!==null&&Date.now()-at>MAX_AGE?'stale':value.code,at);
 }
 async function refresh(){
  const current=++generation;if(controller)controller.abort();controller=new AbortController();const active=controller,timer=setTimeout(()=>active.abort(),8000);
  try{
   const response=await fetch('/api/component-status',{cache:'no-store',credentials:'same-origin',signal:active.signal});if(!response.ok)throw new Error();const body=await response.json();if(current!==generation)return;
   if(body?.available===false){show('not-configured');renderSteam({scope:'provider-discovery-http',linkingVerified:false,code:'not-configured',observedAt:null});renderMap({scope:'cached-position-source',renderingVerified:false,code:'not-configured',observedAt:null});return;}
   if(body?.available!==true||!Array.isArray(body.components)||body.components.length<1||body.components.length>3)throw new Error();if(new Set(body.components.map(v=>v?.id)).size!==body.components.length||body.components.some(v=>!['map-source','bridge-worker','steam-openid'].includes(v?.id)))throw new Error();renderSteam(body.components.find(v=>v?.id==='steam-openid'));renderMap(body.components.find(v=>v?.id==='map-source'));const value=body.components.find(v=>v?.id==='bridge-worker');
   renderWorker(value);
  }catch{if(current===generation){show('unavailable');renderMap(null);renderSteam(null);}}
  finally{clearTimeout(timer);if(current===generation)controller=null;}
 }
 function init(){if(!$('state'))return;document.getElementById('status-refresh')?.addEventListener('click',refresh);refresh();setInterval(()=>{if(!document.hidden)refresh();},30000);}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
