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
 let controller=null,generation=0;
 function show(code,at=null){const [state,label,detail]=messages[code]||messages.unavailable;document.getElementById('status-worker-card').dataset.state=state;$('state').textContent=label;$('detail').textContent=detail;$('time').textContent=at?'Agent snapshot: '+new Date(at).toLocaleString('en-AU',{timeZone:'Australia/Brisbane',dateStyle:'medium',timeStyle:'short'})+' AEST':'No verified worker observation yet';}
 async function refresh(){
  const current=++generation;if(controller)controller.abort();controller=new AbortController();const active=controller,timer=setTimeout(()=>active.abort(),8000);
  try{
   const response=await fetch('/api/component-status',{cache:'no-store',credentials:'same-origin',signal:active.signal});if(!response.ok)throw new Error();const body=await response.json();if(current!==generation)return;
   if(body?.available===false){show('not-configured');return;}
   if(body?.available!==true||!Array.isArray(body.components)||body.components.length!==1)throw new Error();const value=body.components[0];
   if(value?.id!=='bridge-worker'||value.scope!=='windows-scheduled-task'||value.executionVerified!==false||!Object.hasOwn(messages,value.code))throw new Error();
   let at=null;if(value.observedAt!==null){at=Date.parse(value.observedAt);if(typeof value.observedAt!=='string'||!Number.isSafeInteger(at)||at<0||new Date(at).toISOString()!==value.observedAt)throw new Error();}
   if(['running','not-running','queued','unknown-state','stale'].includes(value.code)&&at===null)throw new Error();
   if(at!==null&&at>Date.now()){show('unverified-clock');return;}
   show(at!==null&&Date.now()-at>MAX_AGE?'stale':value.code,at);
  }catch{if(current===generation)show('unavailable');}
  finally{clearTimeout(timer);if(current===generation)controller=null;}
 }
 function init(){if(!$('state'))return;document.getElementById('status-refresh')?.addEventListener('click',refresh);refresh();setInterval(()=>{if(!document.hidden)refresh();},30000);}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
