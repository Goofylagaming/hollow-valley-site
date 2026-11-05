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
 const marketplaceMessages={
  readable:['ok','Catalog readable','The active official catalog passed a read check. Checkout, purchases and dinosaur delivery are not verified.'],
  'empty-catalog':['unknown','No active catalog','No active catalog records were observed. Storefront availability is unverified.'],
  'invalid-catalog':['attention','Catalog needs attention','An active catalog record did not pass the read check. Purchases and delivery are not tested.'],
  'catalog-too-large':['unknown','Catalog check limited','The catalog exceeded the check limits. Its current readability is unverified.'],
  'invalid-observation':['unknown','Observation unverified','The source response or its timestamp could not be verified.'],
  'timed-out':['delayed','Catalog check timed out','The catalog source did not respond within the check window.'],
  stale:['delayed','Delayed','The catalog observation has expired. Current catalog readability is unknown.'],
  'not-configured':['unknown','Not monitored','The Marketplace catalog check is not enabled.'],
  'integration-not-configured':['unknown','Not configured','The catalog source connection is not configured.'],
  'no-observation':['unknown','No observation','No catalog check has finished in this website process yet.'],
  'unverified-clock':['unknown','Clock unverified','The catalog observation time cannot be verified.'],
  unavailable:['unknown','Unknown','The catalog source could not be checked. Purchases and delivery remain unverified.']
 };
 function renderMarketplace(value){
  const card=document.getElementById('status-marketplace-card');if(!card)return;
  let code='unavailable',at=null;
  if(value?.scope==='official-catalog-read'&&value.checkoutVerified===false&&value.fulfillmentVerified===false&&Object.hasOwn(marketplaceMessages,value.code)){
   code=value.code;
   if(value.observedAt!==null){at=Date.parse(value.observedAt);if(typeof value.observedAt!=='string'||!Number.isSafeInteger(at)||at<0||new Date(at).toISOString()!==value.observedAt){code='unavailable';at=null;}}
   if(!['not-configured','integration-not-configured','no-observation','unverified-clock','unavailable'].includes(code)&&at===null)code='unavailable';
   if(at!==null)code=at>Date.now()?'unverified-clock':Date.now()-at>180000?'stale':code;
  }
  const [state,label,detail]=marketplaceMessages[code];card.dataset.state=state;
  document.getElementById('status-marketplace-state').textContent=label;document.getElementById('status-marketplace-detail').textContent=detail;
  document.getElementById('status-marketplace-time').textContent=at!==null?'Catalog observation: '+new Date(at).toLocaleString('en-AU',{timeZone:'Australia/Brisbane',dateStyle:'medium',timeStyle:'short'})+' AEST':'No verified catalog observation yet';
 }
 const rconMessages={
  'read-returned':['ok','Status read returned','An existing RCON status read returned. Command execution and complete player data are not verified.'],
  'read-failed':['attention','Status read failed','The last observed RCON status read failed. This does not establish that the game is offline.'],
  'rcon-disabled':['unknown','Read source disabled','This RCON read source is disabled. The local game worker connection is not checked here.'],
  'connection-not-configured':['unknown','Read source not configured','No RCON connection is configured for this read source.'],
  'invalid-observation':['unknown','Observation unverified','The RCON observation or its timestamp could not be verified.'],
  'timed-out':['delayed','Observation fetch timed out','The observation source did not respond in time. No new RCON query was requested.'],
  stale:['delayed','Delayed','The RCON observation has expired. Current read connectivity is unverified.'],
  'not-configured':['unknown','Not monitored','The RCON observation is not enabled.'],
  'integration-not-configured':['unknown','Not configured','The observation source connection is not configured.'],
  'no-observation':['unknown','No observed read','No timestamped RCON status read has been observed in the source process yet.'],
  'unverified-clock':['unknown','Clock unverified','The RCON observation time cannot be verified.'],
  unavailable:['unknown','Unknown','The observation source could not be checked. This is not a game-server verdict.']
 };
 function renderRcon(value){
  const card=document.getElementById('status-rcon-card');if(!card)return;
  let code='unavailable',at=null;
  if(value?.scope==='automation-rcon-status-read'&&value.commandExecutionVerified===false&&value.playerDataVerified===false&&Object.hasOwn(rconMessages,value.code)){
   code=value.code;
   if(value.observedAt!==null){at=Date.parse(value.observedAt);if(typeof value.observedAt!=='string'||!Number.isSafeInteger(at)||at<0||new Date(at).toISOString()!==value.observedAt){code='unavailable';at=null;}}
   if(['read-returned','read-failed'].includes(code)&&at===null)code='unavailable';
   if(at!==null)code=at>Date.now()?'unverified-clock':Date.now()-at>360000?'stale':code;
  }
  const [state,label,detail]=rconMessages[code];card.dataset.state=state;
  document.getElementById('status-rcon-state').textContent=label;document.getElementById('status-rcon-detail').textContent=detail;
  document.getElementById('status-rcon-time').textContent=at!==null?'RCON read observation: '+new Date(at).toLocaleString('en-AU',{timeZone:'Australia/Brisbane',dateStyle:'medium',timeStyle:'short'})+' AEST':'No timestamped RCON read observed';
 }
 const discordMessages={
  'request-returned':['ok','Authenticated poll returned','An authenticated bridge polling request completed. Discord gateway readiness and message delivery are not verified.'],
  'request-failed':['attention','Polling request failed','The last authenticated polling request failed. This does not establish a Discord gateway outage.'],
  'bridge-not-configured':['unknown','Bridge not configured','The bot bridge contact source is not configured.'],
  'invalid-observation':['unknown','Observation unverified','The bridge contact observation or its time could not be verified.'],
  'timed-out':['delayed','Observation fetch timed out','The contact observation source did not respond in time. The bot was not polled by this check.'],
  stale:['delayed','Delayed','The recorded bridge contact has expired. Current contact is unverified.'],
  'not-configured':['unknown','Not monitored','The bridge contact observation is not enabled.'],
  'integration-not-configured':['unknown','Not configured','The observation source connection is not configured.'],
  'no-observation':['unknown','No observed contact','No completed authenticated polling request has been observed in the source process yet.'],
  'unverified-clock':['unknown','Clock unverified','The bridge contact time cannot be verified.'],
  unavailable:['unknown','Unknown','The contact source could not be checked. Discord gateway and delivery remain unverified.']
 };
 function renderDiscord(value){
  const card=document.getElementById('status-discord-card');if(!card)return;
  let code='unavailable',at=null;
  if(value?.scope==='authenticated-bot-bridge-contact'&&value.gatewayVerified===false&&value.deliveryVerified===false&&Object.hasOwn(discordMessages,value.code)){
   code=value.code;
   if(value.observedAt!==null){at=Date.parse(value.observedAt);if(typeof value.observedAt!=='string'||!Number.isSafeInteger(at)||at<0||new Date(at).toISOString()!==value.observedAt){code='unavailable';at=null;}}
   if(['request-returned','request-failed'].includes(code)&&at===null)code='unavailable';
   if(at!==null)code=at>Date.now()?'unverified-clock':Date.now()-at>180000?'stale':code;
  }
  const [state,label,detail]=discordMessages[code];card.dataset.state=state;
  document.getElementById('status-discord-state').textContent=label;document.getElementById('status-discord-detail').textContent=detail;
  document.getElementById('status-discord-time').textContent=at!==null?'Bridge contact: '+new Date(at).toLocaleString('en-AU',{timeZone:'Australia/Brisbane',dateStyle:'medium',timeStyle:'short'})+' AEST':'No timestamped bridge contact observed';
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
   if(body?.available===false){show('not-configured');renderDiscord({scope:'authenticated-bot-bridge-contact',gatewayVerified:false,deliveryVerified:false,code:'not-configured',observedAt:null});renderRcon({scope:'automation-rcon-status-read',commandExecutionVerified:false,playerDataVerified:false,code:'not-configured',observedAt:null});renderMarketplace({scope:'official-catalog-read',checkoutVerified:false,fulfillmentVerified:false,code:'not-configured',observedAt:null});renderSteam({scope:'provider-discovery-http',linkingVerified:false,code:'not-configured',observedAt:null});renderMap({scope:'cached-position-source',renderingVerified:false,code:'not-configured',observedAt:null});return;}
   if(body?.available!==true||!Array.isArray(body.components)||body.components.length<1||body.components.length>6)throw new Error();if(new Set(body.components.map(v=>v?.id)).size!==body.components.length||body.components.some(v=>!['map-source','bridge-worker','steam-openid','marketplace-catalog','rcon-read','discord-bridge'].includes(v?.id)))throw new Error();renderDiscord(body.components.find(v=>v?.id==='discord-bridge'));renderRcon(body.components.find(v=>v?.id==='rcon-read'));renderMarketplace(body.components.find(v=>v?.id==='marketplace-catalog'));renderSteam(body.components.find(v=>v?.id==='steam-openid'));renderMap(body.components.find(v=>v?.id==='map-source'));const value=body.components.find(v=>v?.id==='bridge-worker');
   renderWorker(value);
  }catch{if(current===generation){show('unavailable');renderMap(null);renderSteam(null);renderMarketplace(null);renderRcon(null);renderDiscord(null);}}
  finally{clearTimeout(timer);if(current===generation)controller=null;}
 }
 function init(){if(!$('state'))return;document.getElementById('status-refresh')?.addEventListener('click',refresh);refresh();setInterval(()=>{if(!document.hidden)refresh();},30000);}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
