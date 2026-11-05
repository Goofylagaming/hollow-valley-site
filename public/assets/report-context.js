/* Private, report-bound recorded context. No source read occurs until requested. */
(() => {
 'use strict';
 const {api}=window.HDS,$=id=>document.getElementById(id);
 let actor=null,epoch=0,locked=false,capability=null;const pending=new Map();
 function clearContexts(item){for(const [controller,owner] of pending)if(!item||owner===item){controller.abort();pending.delete(controller);}const panels=item?item.querySelectorAll('.report-context-panel'):document.querySelectorAll('.report-context-panel');panels.forEach(node=>node.replaceChildren());}
 function lock(message){epoch++;locked=true;capability=null;clearContexts();$('admin-report-list').replaceChildren();$('admin-report-content').hidden=true;$('admin-report-guard').hidden=false;$('admin-report-guard').textContent=message||'Admin access changed. Reload this page.';}
 function valid(ticket){return !locked&&ticket?.binding===actor&&ticket.epoch===epoch;}
 async function check(expected){
  if(locked)throw Error('Reload reports to verify access.');
  let me;try{me=await api('/api/me',{cache:'no-store'});}catch{lock('Admin access could not be verified. Reload this page.');throw Error('Access unverified');}
  if(locked)throw Error('Access changed');
  if(!me?.loggedIn||!me.user?.is_admin||!Number.isSafeInteger(me.user.id)){lock('Current admin access is required. Reload this page.');throw Error('Admin access required');}
  const binding=me.user.id+':'+String(me.user.steam_id||'');
  if((actor&&actor!==binding)||(expected&&expected!==binding)){lock('The admin account changed. Reload this page.');throw Error('Account changed');}
  actor=binding;return {binding,epoch};
 }
 async function prepare(ticket){
  capability=null;
  try{const value=await api('/api/reports/admin/context-capabilities',{cache:'no-store'});await check(ticket.binding);if(!valid(ticket))throw Error('Access changed');if(value.reviewerBinding!==ticket.binding)throw Error('Context account changed');capability={enabled:value.enabled===true};}
  catch{if(!valid(ticket))throw Error('Access changed');capability={enabled:false};}
 }
 function controls(){return capability?.enabled?'<div class="report-context-controls"><button type="button" class="report-context-load">Load recorded context</button><button type="button" class="report-context-hide" hidden>Hide context</button></div><section class="report-context-panel" aria-live="polite"></section>':'';}
 const node=(tag,text)=>{const element=document.createElement(tag);element.textContent=text;return element;};
 const time=value=>new Date(value).toLocaleString('en-AU',{timeZone:'Australia/Brisbane',dateStyle:'medium',timeStyle:'short'})+' AEST';
 const person=role=>role==='reporter'?'Reporter':role==='reported'?'Reported player':'Identity not shown';
 function render(panel,data){
  panel.replaceChildren();
  if(data.available!==true){panel.append(node('p',data.reason==='time-required'?'No usable approximate incident time is saved for this report.':'The saved time is outside the source’s supported window.'));return;}
  const value=data.context;if(value?.associationOnly!==true||value.complete!==false||!Array.isArray(value.combat?.events)||!Array.isArray(value.chat?.messages))throw Error('Invalid context');
  panel.append(node('h4','Recorded context'),node('p','Time and participant matches are context, not proof of an allegation. Retained history may be incomplete.'),node('p',time(value.windowStart)+' — '+time(value.windowEnd)));
  panel.append(node('h5','Recorded combat events'));const events=value.combat.events.slice(0,50);
  if(!value.combat.available)panel.append(node('p','Combat source unavailable.'));
  else if(!events.length)panel.append(node('p','No matching retained combat records were returned.'));
  else{const list=node('ul','');for(const event of events)list.append(node('li',time(event.at)+' · Attacker: '+person(event.attacker)+' · Victim: '+person(event.victim)));panel.append(list);}
  if(value.combat.truncated)panel.append(node('p','Combat results are limited; additional records may be missing.'));
  panel.append(node('h5','Retained participant chat'));const messages=value.chat.messages.slice(0,50);
  if(!value.chat.available)panel.append(node('p','Chat source unavailable.'));
  else if(!messages.length)panel.append(node('p','No matching retained chat messages were returned.'));
  else{const list=node('ul','');list.className='report-context-chat';for(const message of messages){const item=node('li','');item.append(node('strong',person(message.participant)+' · '+(['global','local'].includes(message.channel)?message.channel:'channel not recorded')+' · '+time(message.at)),node('p',message.text));if(message.redacted)item.append(node('small','Some text masked.'));list.append(item);}panel.append(list);}
  if(value.chat.truncated)panel.append(node('p','Chat results are limited; additional messages may be missing.'));
 }
 async function load(button){
  if(button.disabled)return;const item=button.closest('[data-report-id]'),panel=item?.querySelector('.report-context-panel');if(!panel)return;
  const id=item.dataset.reportId,controller=new AbortController();pending.set(controller,item);button.disabled=true;panel.replaceChildren(node('p','Loading private recorded context…'));const hide=item.querySelector('.report-context-hide');hide.hidden=false;
  let ticket;
  try{
   ticket=await check(actor);const result=await api('/api/reports/admin/'+encodeURIComponent(id)+'/context',{cache:'no-store',headers:{'X-Report-Reviewer':ticket.binding},signal:controller.signal});
   await check(ticket.binding);if(controller.signal.aborted||!valid(ticket)||!item.isConnected)return;
   if(result.reportId!==id||result.reviewerBinding!==ticket.binding)throw Error('Context response changed');render(panel,result);button.textContent='Reload recorded context';
  }catch(error){
   if(error.name==='AbortError'||controller.signal.aborted||locked||!item.isConnected)return;
   try{await check(ticket?.binding||actor);}catch{return;}
   if(!valid(ticket))return;panel.replaceChildren(node('p',error.status===409?'The report changed. Reload the report queue before requesting context.':'Recorded context could not be loaded. Retry when the source is available.'));button.textContent='Retry recorded context';if(error.status===409)button.dataset.needsReload='true';
  }finally{pending.delete(controller);if(item.isConnected)button.disabled=button.dataset.needsReload==='true';}
 }
 document.addEventListener('click',event=>{const loadButton=event.target.closest('.report-context-load');if(loadButton)load(loadButton);const hide=event.target.closest('.report-context-hide');if(hide){const item=hide.closest('[data-report-id]');clearContexts(item);item?.querySelector('.report-context-panel')?.replaceChildren();hide.hidden=true;}});
 async function refreshIdentity(){if(locked||!actor||document.hidden)return;const content=$('admin-report-content');content.hidden=true;clearContexts();try{const ticket=await check(actor);if(valid(ticket))content.hidden=false;}catch{}}
 document.addEventListener('visibilitychange',()=>{if(document.hidden){$('admin-report-content').hidden=true;clearContexts();}else refreshIdentity();});window.addEventListener('focus',refreshIdentity);
 setInterval(()=>{if(!document.hidden&&actor&&!locked)check(actor).catch(()=>{});},15000);
 window.HVReportContext={check,prepare,controls,valid,clearContexts,lock};
})();
