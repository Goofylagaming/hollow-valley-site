/* Private, report-bound recorded context. No source read occurs until requested. */
(() => {
 'use strict';
 const {api}=window.HDS,$=id=>document.getElementById(id);
 let actor=null,epoch=0,locked=false,capability=null;const pending=new Map(),records=new Map();
 function clearContexts(item){for(const [owner,state] of records)if(!item||owner===item){if(state.stage==='uncertain'||(state.busy&&state.sent&&state.stage!=='saved')){const source=owner.querySelector('.report-context-load');if(source){source.disabled=true;source.textContent='Reload queue before preparing another save';}}owner.querySelectorAll('.report-context-saved').forEach(value=>{value.disabled=false;});records.delete(owner);}for(const [controller,owner] of pending)if(!item||owner===item){controller.abort();pending.delete(controller);}const panels=item?item.querySelectorAll('.report-context-panel'):document.querySelectorAll('.report-context-panel');panels.forEach(node=>node.replaceChildren());}
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
  try{const value=await api('/api/reports/admin/context-capabilities',{cache:'no-store'});await check(ticket.binding);if(!valid(ticket))throw Error('Access changed');if(value.reviewerBinding!==ticket.binding)throw Error('Context account changed');capability={enabled:value.enabled===true,saveEnabled:value.saveEnabled===true,savedReadEnabled:value.savedReadEnabled===true,retentionDays:value.retentionDays};}
  catch{if(!valid(ticket))throw Error('Access changed');capability={enabled:false};}
 }
 function controls(){if(!capability?.enabled&&!capability?.savedReadEnabled&&!capability?.saveEnabled)return '';return '<div class="report-context-controls">'+(capability.enabled?'<button type="button" class="report-context-load">Load recorded context</button>':'')+((capability.savedReadEnabled||capability.saveEnabled)?'<button type="button" class="report-context-saved">View saved context</button>':'')+'<button type="button" class="report-context-hide" hidden>Hide context</button></div><section class="report-context-panel" aria-live="polite"></section>';}
 const node=(tag,text)=>{const element=document.createElement(tag);element.textContent=text;return element;};
 const time=value=>new Date(value).toLocaleString('en-AU',{timeZone:'Australia/Brisbane',dateStyle:'medium',timeStyle:'short'})+' AEST';
 const person=role=>role==='reporter'?'Reporter':role==='reported'?'Reported player':'Identity not shown';
 function render(panel,data,heading="Recorded context"){
  panel.replaceChildren();
  if(data.available!==true){panel.append(node('p',data.reason==='time-required'?'No usable approximate incident time is saved for this report.':'The saved time is outside the source’s supported window.'));return;}
  const value=data.context;if(value?.associationOnly!==true||value.complete!==false||!Array.isArray(value.combat?.events)||!Array.isArray(value.chat?.messages))throw Error('Invalid context');
  panel.append(node('h4',heading),node('p','Time and participant matches are context, not proof of an allegation. Retained history may be incomplete.'),node('p',time(value.windowStart)+' — '+time(value.windowEnd)));
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
 const active=(item,state,ticket)=>valid(ticket)&&item.isConnected&&records.get(item)===state;
 const button=(label,kind)=>{const value=node('button',label);value.type='button';value.className=kind;return value;};
 function busy(item,on){item.querySelectorAll('.report-context-load,.report-context-saved,.context-review-save,.context-confirm-save,.context-cancel-save,.context-retry-save').forEach(value=>{value.disabled=on;});}
 function saveArea(item){const panel=item.querySelector('.report-context-panel');let area=panel.querySelector('.context-save-area');if(!area){area=node('section','');area.className='context-save-area';panel.append(area);}return area;}
 async function reviewSave(item){
  const state=records.get(item);if(!state?.offer||state.busy||['uncertain','saved'].includes(state.stage))return;const area=saveArea(item),generation=(state.reviewGeneration||0)+1;state.reviewGeneration=generation;area.replaceChildren(node('p','Checking the prepared review…'));
  try{const ticket=await check(state.binding);await prepare(ticket);if(!active(item,state,ticket)||state.busy||state.reviewGeneration!==generation)return;const offer=state.offer;if(!capability?.saveEnabled||capability.retentionDays!==offer.retentionDays||offer.expiresAt<=Date.now())throw Error('Review changed');
   state.body=JSON.stringify({context:state.context,review:offer,requestKey:crypto.randomUUID()});state.stage='review';area.replaceChildren(node('h5','Review saving this context'),node('p','Save the exact recorded context shown above to this report for '+offer.retentionDays+' days from capture. It remains incomplete context, not proof or a moderation decision.'),node('p','Prepared review expires '+time(offer.expiresAt)+'. Reloading or hiding clears this prepared request.'),button('Confirm save for '+offer.retentionDays+' days','context-confirm-save'),button('Cancel save review','context-cancel-save'));
  }catch{if(records.get(item)===state&&!locked)area.replaceChildren(node('p','Saving is unavailable or this review changed. Reload context before preparing another save.'));}
 }
 async function sendSave(item,retry=false){
  const state=records.get(item);if(!state?.body||state.busy||(!retry&&state.stage!=='review')||(retry&&state.stage!=='uncertain'))return;const area=saveArea(item);state.busy=true;busy(item,true);let ticket,posted=false;
  try{ticket=await check(state.binding);if(!active(item,state,ticket))return;if(!retry){await prepare(ticket);if(!active(item,state,ticket))return;if(!capability?.saveEnabled||capability.retentionDays!==state.offer.retentionDays||state.offer.expiresAt<=Date.now())throw Object.assign(Error('Review changed'),{status:409});}
   area.replaceChildren(node('p',retry?'Retrying the same prepared request…':'Saving the reviewed context…'));posted=true;state.sent=true;
   const result=await api('/api/reports/admin/'+encodeURIComponent(item.dataset.reportId)+'/context-snapshots',{method:'POST',headers:{'Content-Type':'application/json','X-Report-Reviewer':ticket.binding},body:state.body});await check(ticket.binding);if(!active(item,state,ticket))return;
   const saved=result.snapshot;if(result.reportId!==item.dataset.reportId||result.reviewerBinding!==ticket.binding||!saved?.id||saved.contextDigest!==state.offer.contextDigest||saved.retentionDays!==state.offer.retentionDays||typeof saved.replayed!=='boolean')throw Error('Unconfirmed save');
   state.body=null;state.stage='saved';area.replaceChildren(node('p','Saved context retained until '+time(saved.expiresAt)+'. The report’s moderation status was not changed.'),button('View saved copy','context-view-saved'));area.querySelector('button').dataset.snapshotId=saved.id;
  }catch(error){
   if(locked||records.get(item)!==state)return;try{await check(ticket?.binding||state.binding);}catch{return;}if(!active(item,state,ticket))return;
   if(posted&&(!error.status||error.status>=500)){state.stage='uncertain';area.replaceChildren(node('p','The save result is uncertain. Retry the same request to recover its result; do not prepare a new save. You can also inspect saved context. Reloading clears the prepared request.'),button('Retry same save request','context-retry-save'));}
   else{state.body=null;state.stage='rejected';area.replaceChildren(node('p','Save rejected or review changed. Reload context and review again before saving.'));}
  }finally{state.busy=false;if(records.get(item)===state){busy(item,false);if(['uncertain','saved'].includes(state.stage))item.querySelectorAll('.context-review-save').forEach(value=>{value.disabled=true;});if(state.stage==='uncertain')item.querySelectorAll('.report-context-load').forEach(value=>{value.disabled=true;});}}
 }
 async function savedRequest(item,kind,snapshotId){
  const panel=item.querySelector('.report-context-panel');let state=records.get(item);if(!state){state={binding:actor};records.set(item,state);panel.replaceChildren();}if(state.busy)return;
  const generation=(state.savedGeneration||0)+1;state.savedGeneration=generation;const controller=new AbortController();pending.set(controller,item);let ticket;let area=panel.querySelector('.context-saved-area');if(!area){area=node('section','');area.className='context-saved-area';panel.append(area);}area.replaceChildren(node('p','Loading private saved context…'));item.querySelector('.report-context-hide').hidden=false;
  try{ticket=await check(state.binding);const result=await api('/api/reports/admin/'+encodeURIComponent(item.dataset.reportId)+'/context-snapshots'+(snapshotId?'/'+encodeURIComponent(snapshotId):''),{cache:'no-store',headers:{'X-Report-Reviewer':ticket.binding},signal:controller.signal});await check(ticket.binding);if(controller.signal.aborted||!active(item,state,ticket)||state.savedGeneration!==generation)return;if(result.reportId!==item.dataset.reportId||result.reviewerBinding!==ticket.binding)throw Error('Saved response changed');area.replaceChildren();
   if(kind==='list'){if(!Array.isArray(result.items))throw Error('Saved list unavailable');area.append(node('h5','Saved context copies'),node('p','If a save was interrupted or the page was reloaded, inspect saved copies before preparing another save.'));if(!result.items.length)area.append(node('p','No unexpired saved copies were returned.'));for(const saved of result.items.slice(0,50)){const row=node('div','');row.append(node('p','Captured '+time(saved.capturedAt)+' · retained until '+time(saved.expiresAt)+' · moderator account '+saved.capturedByUserId));const view=button('View saved copy','context-view-saved');view.dataset.snapshotId=saved.id;row.append(view);area.append(row);}}
   else{if(result.snapshot?.id!==snapshotId)throw Error('Saved copy changed');area.append(node('p','Preserved copy captured '+time(result.snapshot.capturedAt)+'; retained until '+time(result.snapshot.expiresAt)+'.'));const detail=node('div','');render(detail,{available:true,context:result.snapshot.context},'Saved context');area.append(detail);}
  }catch(error){if(controller.signal.aborted||locked||records.get(item)!==state)return;try{await check(ticket?.binding||state.binding);}catch{return;}if(active(item,state,ticket)&&state.savedGeneration===generation)area.replaceChildren(node('p',error.status===410?'This saved context has expired. Reload the saved list.':'Saved context could not be loaded or its report binding changed. Retry the saved list.'));}
  finally{pending.delete(controller);}
 }
 function buttonForReview(){return button('Review saving this context','context-review-save');}
 async function load(button){
  if(button.disabled)return;const item=button.closest('[data-report-id]'),panel=item?.querySelector('.report-context-panel');if(!panel)return;
  records.delete(item);const id=item.dataset.reportId,controller=new AbortController();pending.set(controller,item);button.disabled=true;panel.replaceChildren(node('p','Loading private recorded context…'));const hide=item.querySelector('.report-context-hide');hide.hidden=false;
  let ticket;
  try{
   ticket=await check(actor);const result=await api('/api/reports/admin/'+encodeURIComponent(id)+'/context',{cache:'no-store',headers:{'X-Report-Reviewer':ticket.binding},signal:controller.signal});
   await check(ticket.binding);if(controller.signal.aborted||!valid(ticket)||!item.isConnected)return;
   if(result.reportId!==id||result.reviewerBinding!==ticket.binding)throw Error('Context response changed');render(panel,result);const state={binding:ticket.binding,context:result.context,offer:result.review,stage:'loaded'};records.set(item,state);if(result.available&&result.review&&capability?.saveEnabled){panel.append(buttonForReview());}button.textContent='Reload recorded context';
  }catch(error){
   if(error.name==='AbortError'||controller.signal.aborted||locked||!item.isConnected)return;
   try{await check(ticket?.binding||actor);}catch{return;}
   if(!valid(ticket))return;panel.replaceChildren(node('p',error.status===409?'The report changed. Reload the report queue before requesting context.':'Recorded context could not be loaded. Retry when the source is available.'));button.textContent='Retry recorded context';if(error.status===409)button.dataset.needsReload='true';
  }finally{pending.delete(controller);if(item.isConnected)button.disabled=button.dataset.needsReload==='true';}
 }
 document.addEventListener('click',event=>{const item=event.target.closest('[data-report-id]');if(item){if(event.target.closest('.report-context-saved'))savedRequest(item,'list');if(event.target.closest('.context-review-save'))reviewSave(item);if(event.target.closest('.context-confirm-save'))sendSave(item);if(event.target.closest('.context-retry-save'))sendSave(item,true);const view=event.target.closest('.context-view-saved');if(view)savedRequest(item,'read',view.dataset.snapshotId);if(event.target.closest('.context-cancel-save')){const state=records.get(item);if(state&&!state.busy){state.reviewGeneration=(state.reviewGeneration||0)+1;state.body=null;state.stage='loaded';saveArea(item).replaceChildren(node('p','Save review cancelled. Nothing was saved.'));}}}const loadButton=event.target.closest('.report-context-load');if(loadButton)load(loadButton);const hide=event.target.closest('.report-context-hide');if(hide){const item=hide.closest('[data-report-id]');clearContexts(item);item?.querySelector('.report-context-panel')?.replaceChildren();hide.hidden=true;}});
 async function refreshIdentity(){if(locked||!actor||document.hidden)return;const content=$('admin-report-content');content.hidden=true;clearContexts();try{const ticket=await check(actor);if(valid(ticket))content.hidden=false;}catch{}}
 document.addEventListener('visibilitychange',()=>{if(document.hidden){$('admin-report-content').hidden=true;clearContexts();}else refreshIdentity();});window.addEventListener('focus',refreshIdentity);
 setInterval(()=>{if(!document.hidden&&actor&&!locked)check(actor).catch(()=>{});},15000);
 window.HVReportContext={check,prepare,controls,valid,clearContexts,lock};
})();
