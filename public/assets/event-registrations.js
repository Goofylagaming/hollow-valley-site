(() => {
 'use strict';
 const {api}=window.HDS,$=id=>document.getElementById('event-registration-'+id),base='/api/event-registrations';
 let actor=null,caps={},model=null,review=null,busy=false,next=null,hasHistory=false,requested=false;
 const identity=me=>me?.loggedIn&&Number.isSafeInteger(me.user?.id)&&/^\d{17}$/.test(String(me.user?.steam_id||''))?me.user.id+':'+me.user.steam_id:null;
 const writable=()=>actor&&!caps.readOnly;
 const canConfirm=()=>writable()&&review&&review.actor===actor&&(caps.enabled||!review.body.selected||review.uncertain);
 const date=at=>new Date(at).toLocaleString('en-AU',{timeZone:'Australia/Brisbane'});
 const message=text=>$('status').textContent=text;
 function clear(){actor=null;model=null;review=null;next=null;hasHistory=false;requested=false;for(const name of ['list','details','summary','history'])$(name).replaceChildren();}
 function render(){
  $('panel').hidden=!hasHistory&&!model&&!review&&!requested;$('panel').setAttribute('aria-busy',String(busy));$('preview').textContent=caps.readOnly?'This preview is read-only.':'';
  $('signin').hidden=Boolean(actor);$('refresh').disabled=busy||Boolean(review);$('more').hidden=!next;$('more').disabled=busy||Boolean(review);
  $('join').textContent=model?.selected?'Review new event time':'Review reserving a place';
  $('join').disabled=busy||Boolean(review)||!writable()||!caps.enabled||!model?.canJoin||(!model.selected&&model.placesAvailable===0)||(model.selected&&model.state!=='review-new-time');
  $('leave').disabled=busy||Boolean(review)||!writable()||!model?.selected;
  $('review').hidden=!review;$('confirm').disabled=busy||!canConfirm();$('confirm').textContent=review?.uncertain?'Retry saved registration request':'Confirm registration choice';$('cancel').disabled=busy;
  for(const button of $('list').querySelectorAll('button'))button.disabled=busy||Boolean(review);
 }
 async function check(){const me=await api('/api/me',{cache:'no-store'});if(identity(me)!==actor||!me.eventRegistrationManagementAvailable){clear();throw new Error('Your account changed. Refresh to continue.');}}
 async function run(fn){if(busy)return;busy=true;render();try{await fn();}catch(e){const visible=requested||hasHistory;clear();requested=visible;message(e.message||'Registration is unavailable. Refresh to try again.');}finally{busy=false;render();}}
 function showModel(value){model=value;$('details').replaceChildren();if(!value)return;
  const lines=[value.event.title,`${date(value.event.startsAt)}–${date(value.event.endsAt)} Brisbane`,value.event.description,'Rules: '+value.event.rules,
   value.state==='event-cancelled'?'This website event was cancelled. Registration is not attendance or a confirmed game outcome.':value.state==='review-new-time'?'The schedule changed. Your place remains reserved, but you have not accepted the new time.':value.state==='registered'?'Your place is reserved. This is not attendance confirmation.':value.state==='unavailable'?'The source schedule is unavailable. You can still withdraw your saved registration.':value.state==='withdrawn'?'You withdrew your registration.':'You have not reserved a place.',
   value.acceptedEvent&&value.selected&&value.acceptedEvent.revision!==value.event.revision?'Previously accepted start: '+date(value.acceptedEvent.startsAt)+' Brisbane.':'',
   value.sourceAvailable?`${value.reservedPlaces} / ${value.event.capacity} places reserved. There is no waitlist or automatic enrollment.`:''];
  lines.push(value.plannedTeam?.state==='planned'?`Your planned team: Team ${value.plannedTeam.team}. This is website organization, not a verified in-game team.`:value.plannedTeam?.state==='needs-staff-review'?'Planned teams need staff review after a roster or schedule change.':value.plannedTeam?.state==='unavailable'?'Planned team information is unavailable.':'No current planned team is assigned.');
  for(const text of lines.filter(Boolean)){const p=document.createElement('p');p.textContent=text;$('details').append(p);}
 }
 async function history(){if(!model||!model.revision)return;await check();const page=await api(base+'/'+encodeURIComponent(model.event.id)+'/history',{cache:'no-store'});await check();$('history').replaceChildren();for(const item of page.items){const li=document.createElement('li');li.textContent=`Revision ${item.revision}: ${item.selected?'accepted event revision '+item.eventRevision:'withdrew'} · ${date(item.at)} Brisbane · planned start ${date(item.acceptedEvent.startsAt)}`;$('history').append(li);}}
 async function loadList(more=false){await check();const page=await api(base+'/me'+(more&&next?'?before='+next:''),{cache:'no-store'});await check();if(!more)$('list').replaceChildren();for(const item of page.items){const li=document.createElement('li'),button=document.createElement('button');button.type='button';button.className='small-button';button.textContent=`${item.event.title} · ${date(item.event.startsAt)} Brisbane · ${item.state.replaceAll('-',' ')}`;button.addEventListener('click',()=>open(item.event.id));li.append(button);$('list').append(li);}next=page.next;hasHistory=Boolean($('list').children.length);}
 async function refresh(){const me=await api('/api/me',{cache:'no-store'}),who=identity(me);if(!who||!me.eventRegistrationManagementAvailable){clear();caps={};return;}if(who!==actor){clear();actor=who;}caps=await api(base+'/capabilities',{cache:'no-store'});await check();await loadList();if(model){const latest=await api(base+'/'+encodeURIComponent(model.event.id),{cache:'no-store'});await check();showModel(latest);await history();}message(caps.enabled?'Review an event to reserve a place. No coins are charged or awarded.':'New registration is paused. Saved registrations can still be viewed or withdrawn.');}
 function open(id){if(busy||review){message('Close the current registration review before choosing another event.');return;}void run(async()=>{
  await refresh();requested=true;if(!actor){message('Sign in with Steam to manage your registration.');return;}
  showModel(null);$('history').replaceChildren();const result=await api(base+'/'+encodeURIComponent(id),{cache:'no-store'});await check();showModel(result);await history();message('Review this event and its rules before changing your registration.');
 });}
 function prepare(selected){if(busy||review||!writable()||!model)return;if(selected&&(!caps.enabled||!model.canJoin))return;if(!selected&&!model.selected)return;
  const body={selected,expectedRevision:model.revision,requestKey:crypto.randomUUID(),...(selected?{eventRevision:model.event.revision}:{})};review={actor,id:model.event.id,body,uncertain:false};$('summary').replaceChildren();for(const text of [selected?'Reserve a place for the exact schedule and rules shown below. This is not attendance, a team assignment or a reward.':'Withdraw this registration and release its reserved place. Registration history and request receipts remain.',model.event.title,`${date(model.event.startsAt)}–${date(model.event.endsAt)} Brisbane`,'Rules: '+model.event.rules,model.state==='review-new-time'?'The original reservation is being reconfirmed for the new time. No additional place will be reserved.':'']){const p=document.createElement('p');p.textContent=text;$('summary').append(p);}message('Confirm this reviewed registration choice.');render();
 }
 $('join').addEventListener('click',()=>prepare(true));$('leave').addEventListener('click',()=>prepare(false));$('cancel').addEventListener('click',()=>{if(!busy){review=null;message('Review closed. Refresh to inspect your current registration before recreating an unconfirmed request.');render();}});
 $('refresh').addEventListener('click',()=>void run(refresh));$('more').addEventListener('click',()=>void run(()=>loadList(true)));
 $('confirm').addEventListener('click',()=>void run(async()=>{if(!canConfirm())return;const saved=review;await check();caps=await api(base+'/capabilities',{cache:'no-store'});if(!canConfirm()){message('This choice is unavailable while registration is paused or this preview is read-only.');return;}let result;
  try{result=await api(base+'/'+encodeURIComponent(saved.id),{method:'POST',body:JSON.stringify(saved.body)});}catch(e){if(!e.status||e.status>=500){saved.uncertain=true;message('The reply was not confirmed. Retry the saved registration request to recover the current choice.');return;}if(e.status===409){review=null;const latest=await api(base+'/'+encodeURIComponent(saved.id),{cache:'no-store'});await check();showModel(latest);message(e.message+' Review the current choice before continuing.');return;}throw e;}
  await check();review=null;showModel(result.current);await loadList();await history();message(result.current.state==='event-cancelled'?'This event was cancelled. Your saved registration remains in history.':result.current.state==='unavailable'?'The source schedule is unavailable. Your saved choice is shown below.':result.current.selected?'Your current place is reserved. Check the displayed schedule state; this is not attendance confirmation.':'Your current registration is withdrawn. Its reserved place has been released.');
 }));
 document.addEventListener('event-registration-open',event=>open(event.detail?.id));
 window.addEventListener('focus',()=>{if(actor&&!busy)void run(async()=>{await check();caps=await api(base+'/capabilities',{cache:'no-store'});});});
 void run(refresh);
})();
