(() => {
 'use strict';
 const {api}=window.HDS,$=name=>document.getElementById('event-team-'+name),base='/api/event-teams';
 let actor=null,caps={},model=null,review=null,busy=false,next=null;
 const identity=me=>me?.loggedIn&&Number.isSafeInteger(me.user?.id)&&me.user?.is_admin&&/^\d{17}$/.test(String(me.user?.steam_id||''))?me.user.id+':'+me.user.steam_id:null;
 const writable=()=>actor&&!caps.readOnly;
 const message=text=>$('status').textContent=text;
 const date=at=>new Date(at).toLocaleString('en-AU',{timeZone:'Australia/Brisbane'});
 function clear(){actor=null;model=null;review=null;next=null;$('reason').value='';for(const name of ['events','roster','summary','history'])$(name).replaceChildren();}
 function render(){
  $('panel').hidden=!actor;$('panel').setAttribute('aria-busy',String(busy));$('preview').textContent=caps.readOnly?'This preview is read-only.':!caps.enabled?'New team assignments are paused. Saved rosters and history remain readable.':'';
  $('selected').textContent=model?`${model.event.title} · ${date(model.event.startsAt)} Brisbane · event revision ${model.event.revision}`:'Choose an event';
  $('plan').textContent=model?.plan?(model.plan.active?`Planned teams are current · plan revision ${model.plan.revision}.`:`Saved plan revision ${model.plan.revision} needs review. Proposed teams below have not been saved.`):'No team plan has been saved.';
  $('reason').disabled=busy||Boolean(review)||!writable()||!caps.enabled||!model?.canAssign;
  for(const input of $('roster').querySelectorAll('select'))input.disabled=$('reason').disabled;
  $('prepare').disabled=$('reason').disabled;$('refresh').disabled=busy||Boolean(review);$('reload').disabled=busy||Boolean(review)||!model;
  $('more').hidden=!next;$('more').disabled=busy||Boolean(review);for(const button of $('events').querySelectorAll('button'))button.disabled=busy||Boolean(review);
  $('review').hidden=!review;$('confirm').disabled=busy||!review||!writable()||review.actor!==actor||(!caps.enabled&&!review.uncertain);$('confirm').textContent=review?.uncertain?'Retry saved team request':'Confirm planned teams';$('cancel').disabled=busy;
 }
 async function check(){const me=await api('/api/me',{cache:'no-store'});if(identity(me)!==actor||!me.eventTeamManagementAvailable){clear();throw new Error('Your account or staff access changed. Refresh to continue.');}}
 async function run(fn){if(busy)return;busy=true;render();try{await fn();}catch(e){clear();message(e.message||'Event teams are unavailable. Refresh to try again.');}finally{busy=false;render();}}
 function show(value){model=value;$('roster').replaceChildren();$('history').replaceChildren();$('reason').value='';if(!value)return;
  const assignments=new Map((value.plan?.active?value.plan.assignments:value.proposal).map(p=>[p.steamId,p.team]));
  for(const member of value.members){const li=document.createElement('li'),label=document.createElement('label'),text=document.createElement('span');text.textContent=`${member.name} · ${member.steamId} · registration revision ${member.registrationRevision}`;label.append(text);
   if(member.eligible){const select=document.createElement('select');select.dataset.steamId=member.steamId;select.setAttribute('aria-label','Planned team for '+member.name);for(let n=1;n<=value.event.teamCount;n++){const option=document.createElement('option');option.value=String(n);option.textContent='Team '+n;select.append(option);}select.value=String(assignments.get(member.steamId));label.append(select);}else{const state=document.createElement('p');state.textContent=member.userId===null?'Linked account unavailable; excluded from planned teams.':'Waiting for this player to confirm the new schedule; excluded from planned teams.';label.append(state);}li.append(label);$('roster').append(li);
  }
 }
 async function loadHistory(){if(!model)return;await check();const page=await api(base+'/'+encodeURIComponent(model.event.id)+'/history',{cache:'no-store'});await check();$('history').replaceChildren();for(const item of page.items){const li=document.createElement('li'),details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=`Plan ${item.revision} · ${item.actorSteamId} · ${date(item.at)} Brisbane · event revision ${item.event.revision}`;details.append(summary);const reason=document.createElement('p');reason.textContent=item.reason;details.append(reason);for(const assignment of item.assignments){const p=document.createElement('p');p.textContent=assignment.steamId+' · Team '+assignment.team;details.append(p);}li.append(details);$('history').append(li);}}
 async function loadEvents(more=false){await check();const page=await api(base+(more&&next?'?before='+next:''),{cache:'no-store'});await check();if(!more)$('events').replaceChildren();for(const event of page.items){const li=document.createElement('li'),button=document.createElement('button');button.type='button';button.className='small-button';button.textContent=`${event.title} · ${date(event.startsAt)} Brisbane · ${event.state}`;button.addEventListener('click',()=>void run(()=>load(event.id)));li.append(button);$('events').append(li);}next=page.next;}
 async function load(id){await check();const result=await api(base+'/'+encodeURIComponent(id),{cache:'no-store'});await check();show(result);await loadHistory();message('Review schedule-confirmed registrations and planned teams. This does not verify in-game eligibility or attendance.');}
 async function refresh(){const me=await api('/api/me',{cache:'no-store'}),who=identity(me);if(!who||!me.eventTeamManagementAvailable){clear();caps={};return;}if(who!==actor){clear();actor=who;}caps=await api(base+'/capabilities',{cache:'no-store'});await check();await loadEvents();if(model)await load(model.event.id);else message('Choose an event to inspect its private roster and plan teams.');}
 $('refresh').addEventListener('click',()=>void run(refresh));$('more').addEventListener('click',()=>void run(()=>loadEvents(true)));$('reload').addEventListener('click',()=>{if(model)void run(()=>load(model.event.id));});
 $('prepare').addEventListener('click',()=>{
  if(busy||review||!writable()||!caps.enabled||!model?.canAssign)return;if(!$('reason').reportValidity())return;
  const assignments=Array.from($('roster').querySelectorAll('select')).map(select=>({steamId:select.dataset.steamId,team:Number(select.value)}));
  review={actor,id:model.event.id,body:{expectedRevision:model.plan?.revision||0,eventRevision:model.event.revision,rosterDigest:model.digest,assignments,reason:$('reason').value,requestKey:crypto.randomUUID()},uncertain:false};
  $('summary').replaceChildren();const title=document.createElement('p');title.textContent=`${model.event.title} · event revision ${model.event.revision} · ${date(model.event.startsAt)} Brisbane. Save these planned teams. No attendance or game outcome is confirmed.`;$('summary').append(title);for(const assignment of assignments){const p=document.createElement('p');p.textContent=assignment.steamId+' · Team '+assignment.team;$('summary').append(p);}const reason=document.createElement('p');reason.textContent=review.body.reason;$('summary').append(reason);message('Review this exact roster and assignment before confirming.');render();
 });
 $('cancel').addEventListener('click',()=>{if(!busy){review=null;message('Review closed. Reload the roster before recreating an unconfirmed request.');render();}});
 $('confirm').addEventListener('click',()=>void run(async()=>{if(!review||!writable())return;const saved=review;await check();caps=await api(base+'/capabilities',{cache:'no-store'});if(!writable()||!caps.enabled&&!saved.uncertain){message('New team changes are unavailable in this preview or rollout pause.');return;}let result;
  try{result=await api(base+'/'+encodeURIComponent(saved.id),{method:'POST',body:JSON.stringify(saved.body)});}catch(e){if(!e.status||e.status>=500){saved.uncertain=true;message('The reply was not confirmed. Retry this saved team request to recover its result.');return;}if(e.status===409){review=null;await load(saved.id);message(e.message+' Review the refreshed roster and proposed teams again.');return;}throw e;}
  await check();review=null;show(result.current);await loadHistory();message(`Saved plan revision ${result.saved.revision}.`+(result.current.plan?.active?' Planned teams are current.':' The roster changed; staff must review the current proposal.'));
 }));
 window.addEventListener('focus',()=>{if(actor&&!busy)void run(async()=>{await check();caps=await api(base+'/capabilities',{cache:'no-store'});});});void run(refresh);
})();
