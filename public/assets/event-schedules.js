(() => {
 'use strict';
 const {api}=window.HDS,$=name=>document.getElementById('event-schedule-'+name),base='/api/event-schedules';
 let actor=null,caps={},current=null,review=null,busy=false,sources=new Map(),sourceNext=null,next=null,publicNext=null,clockAt=0,clockRead=0,calendarEpoch=0;
 const identity=me=>me?.loggedIn&&Number.isSafeInteger(me.user?.id)&&me.user?.is_admin&&/^\d{17}$/.test(String(me.user?.steam_id||''))?me.user.id+':'+me.user.steam_id:null;
 const writable=()=>actor&&caps.enabled&&!caps.readOnly;
 const message=text=>$('status').textContent=text;
 const local=at=>new Date(at+36000000).toISOString().slice(0,16);
 const date=at=>new Date(at).toLocaleString('en-AU',{timeZone:'Australia/Brisbane'});
 function parseTime(){const value=$('time').value,at=Date.parse(value+':00+10:00');if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)||!Number.isFinite(at)||local(at)!==value)throw new Error('Choose a valid Brisbane start time.');return at;}
 function clear(){actor=null;current=null;review=null;next=null;sources.clear();sourceNext=null;$('form').reset();for(const name of ['list','history','summary','source'])$(name).replaceChildren();}
 function render(){
  $('panel').hidden=!actor||!caps.enabled;$('panel').setAttribute('aria-busy',String(busy));$('preview').textContent=caps.readOnly?'This preview is read-only.':'';
  $('selected').textContent=current?`${current.definition.title} · revision ${current.revision} · ${current.state}`:'New event schedule';
  for(const control of $('form').elements)control.disabled=busy||Boolean(review)||!writable()||current?.state==='cancelled';
  $('source').disabled=busy||Boolean(review)||!writable()||Boolean(current);
  $('save').textContent=current?'Review new start time':'Review event draft';
  $('save').disabled=busy||Boolean(review)||!writable()||current?.state==='cancelled';
  $('publish').disabled=busy||Boolean(review)||!writable()||current?.state!=='draft';$('cancel-event').disabled=busy||Boolean(review)||!writable()||!current||current.state==='cancelled';
  $('refresh').disabled=busy||Boolean(review);$('new').disabled=busy||Boolean(review)||!writable();
  for(const button of $('list').querySelectorAll('button'))button.disabled=busy||Boolean(review);
  $('more').hidden=!next;$('more').disabled=busy||Boolean(review);$('source-more').hidden=!sourceNext;$('source-more').disabled=busy||Boolean(review)||Boolean(current);
  $('review').hidden=!review;$('confirm').disabled=busy||!review||!writable()||review.actor!==actor;$('confirm').textContent=review?.uncertain?'Retry saved schedule request':'Confirm schedule change';$('close-review').disabled=busy;
 }
 async function check(){const me=await api('/api/me',{cache:'no-store'});if(identity(me)!==actor||!me.eventScheduleBuilderEnabled){clear();throw new Error('Your account or staff access changed. Refresh to continue.');}}
 async function run(fn){if(busy)return;busy=true;render();try{await fn();}catch(e){if([401,403].includes(e.status)){clear();caps={};}message(e.message||'Schedules are unavailable. Refresh to try again.');}finally{busy=false;render();}}
 async function loadSources(more=false){await check();const page=await api('/api/event-templates'+(more&&sourceNext?'?before='+sourceNext:''),{cache:'no-store'});await check();if(!more){sources.clear();$('source').replaceChildren();}for(const item of page.items){sources.set(item.id,item);const option=document.createElement('option');option.value=item.id;option.textContent=`${item.definition.title} · revision ${item.revision}`;$('source').append(option);}sourceNext=page.next;}
 function populate(item){current=item;$('form').reset();$('history').replaceChildren();if(item)$('time').value=local(item.startsAt);}
 async function loadHistory(){if(!current)return;await check();const page=await api(base+'/'+encodeURIComponent(current.id)+'/history',{cache:'no-store'});await check();$('history').replaceChildren();for(const item of page.items){const li=document.createElement('li');li.textContent=`Revision ${item.revision} · ${item.action} · ${date(item.schedule.startsAt)} Brisbane · ${item.reason||'Draft created from template revision '+item.schedule.templateRevision}`;$('history').append(li);}}
 async function loadList(more=false){await check();const page=await api(base+(more&&next?'?before='+next:''),{cache:'no-store'});await check();if(!more)$('list').replaceChildren();for(const item of page.items){const li=document.createElement('li'),button=document.createElement('button');button.type='button';button.className='small-button';button.textContent=`${item.definition.title} · ${date(item.startsAt)} Brisbane · ${item.state} · r${item.revision}`;button.addEventListener('click',()=>void run(async()=>{await check();const selected=await api(base+'/'+encodeURIComponent(item.id),{cache:'no-store'});await check();populate(selected);await loadHistory();message('Loaded the saved schedule and its frozen rules.');}));li.append(button);$('list').append(li);}next=page.next;}
 function countdowns(){const now=clockAt+(performance.now()-clockRead);for(const element of $('calendar-list').querySelectorAll('[data-planned-start]')){const start=Number(element.dataset.plannedStart),end=Number(element.dataset.plannedEnd),minutes=Math.ceil((start-now)/60000);element.textContent=now<start?`Planned start in ${minutes>=1440?Math.floor(minutes/1440)+' days ':''}${Math.floor(minutes%1440/60)} hours ${minutes%60} minutes.`:now<end?'Planned start passed. Await staff confirmation; game activity is unverified.':'Planned end passed. No event result is confirmed here.';}}
 async function calendar(more=false){
  const token=++calendarEpoch;
  try{
   const page=await api(base+'/public'+(more&&publicNext?'?afterTime='+publicNext.startsAt+'&afterId='+encodeURIComponent(publicNext.id):''),{cache:'no-store'});
   if(token!==calendarEpoch)return;
   if(!more)$('calendar-list').replaceChildren();$('calendar').hidden=!page.enabled;clockAt=page.checkedAt;clockRead=performance.now();
   for(const event of page.events){
    if(more&&Array.from($('calendar-list').children).some(card=>card.dataset.eventId===event.id))continue;
    const card=document.createElement('article'),heading=document.createElement('h3'),time=document.createElement('p'),description=document.createElement('p'),rules=document.createElement('details'),summary=document.createElement('summary'),ruleText=document.createElement('p'),countdown=document.createElement('p');
    card.dataset.eventId=event.id;heading.textContent=event.title;time.textContent=`${date(event.startsAt)}–${date(event.endsAt)} Brisbane · capacity ${event.capacity} · ${event.teamCount} planned teams`;description.textContent=event.description;summary.textContent='Published event rules';ruleText.textContent=event.rules;rules.append(summary,ruleText);countdown.dataset.plannedStart=event.startsAt;countdown.dataset.plannedEnd=event.endsAt;card.append(heading,time,description,rules,countdown);$('calendar-list').append(card);
   }
   publicNext=page.next;$('calendar-more').hidden=!publicNext;$('calendar-status').textContent=page.events.length||more?'Website schedules are plans. Registration and game execution are not enabled here.':'No published website schedules.';countdowns();
  }catch(e){if(token!==calendarEpoch)return;$('calendar-list').replaceChildren();publicNext=null;$('calendar-more').hidden=true;$('calendar-status').textContent='Website schedules are unavailable. Refresh to check the latest changes.';}
 }
 function hideCalendar(){calendarEpoch++;$('calendar').hidden=true;$('calendar-list').replaceChildren();publicNext=null;}
 async function refresh(){const me=await api('/api/me',{cache:'no-store'});if(me.eventSchedulesEnabled)await calendar();else hideCalendar();
  const who=identity(me);if(!who||!me.eventScheduleBuilderEnabled){clear();caps={};return;}if(who!==actor){clear();actor=who;}caps=await api(base+'/capabilities',{cache:'no-store'});await check();if(!caps.enabled){clear();return;}populate(null);await loadSources();await loadList();message('Create a private draft, then separately review publishing it on the website.');
 }
 function prepare(action){if(busy||review||!writable())return;try{
  const source=current?null:sources.get($('source').value);if(!current&&!source)throw new Error('Choose a saved template first.');
  if(action==='publish'&&current?.state!=='draft'||action==='cancel'&&!current)throw new Error('Choose an eligible saved schedule.');
  const body={action,expectedRevision:current?.revision||0,requestKey:crypto.randomUUID()};
  if(action==='create'){body.templateId=source.id;body.templateRevision=source.revision;body.startsAt=parseTime();}else{body.reason=$('reason').value;if(body.reason.trim().length<10)throw new Error('Enter a staff reason of at least ten characters.');if(action==='reschedule')body.startsAt=parseTime();}
  const definition=current?.definition||source.definition,startsAt=body.startsAt??current.startsAt,endsAt=startsAt+definition.durationMinutes*60000;
  review={actor,id:current?.id||crypto.randomUUID(),body,uncertain:false};$('summary').replaceChildren();for(const text of [action==='publish'?'Publish this schedule and its rules on the public website.':action==='cancel'?'Cancel this website listing. This does not verify an in-game outcome.':action==='create'?'Save a private event draft. It will not appear publicly.':'Change the saved start time. A published listing will show the new time.',definition.title,definition.description,'Rules: '+definition.rules,`Template revision ${current?.templateRevision||source.revision} · ${date(startsAt)}–${date(endsAt)} Brisbane`,`${definition.capacity} planned participants · ${definition.teamCount} teams`,body.reason||'']){const p=document.createElement('p');p.textContent=text;$('summary').append(p);}message('Review the frozen rules and exact schedule before confirming.');render();
 }catch(e){message(e.message);}}
 $('form').addEventListener('submit',e=>{e.preventDefault();prepare(current?'reschedule':'create');});$('publish').addEventListener('click',()=>prepare('publish'));$('cancel-event').addEventListener('click',()=>prepare('cancel'));
 $('new').addEventListener('click',()=>{if(busy||review)return;populate(null);render();});$('refresh').addEventListener('click',()=>void run(refresh));$('more').addEventListener('click',()=>void run(()=>loadList(true)));$('source-more').addEventListener('click',()=>void run(()=>loadSources(true)));
 $('close-review').addEventListener('click',()=>{if(!busy){review=null;message('Review closed. Inspect saved schedules before recreating a request whose reply was unconfirmed.');render();}});
 $('confirm').addEventListener('click',()=>void run(async()=>{if(!review||!writable())return;const saved=review;await check();caps=await api(base+'/capabilities',{cache:'no-store'});if(!writable()){message('Schedule changes are unavailable in this preview.');return;}let result;try{result=await api(base+'/'+encodeURIComponent(saved.id),{method:'POST',body:JSON.stringify(saved.body)});}catch(e){if(!e.status||e.status>=500){saved.uncertain=true;message('The reply was not confirmed. Retry the saved schedule request to recover its result.');return;}if(e.status===409){review=null;message(e.message+' Refresh and review the saved schedule again.');await loadList();return;}throw e;}await check();review=null;populate(result.current);await loadList();await loadHistory();await calendar();message(`Saved schedule revision ${result.saved.revision}. Current state: ${result.current.state}. No game action or Discord announcement was sent.`);}));
 $('calendar-refresh').addEventListener('click',()=>void calendar());$('calendar-more').addEventListener('click',()=>void calendar(true));
 setInterval(countdowns,15000);
 setInterval(()=>{if(!document.hidden)void api('/api/me',{cache:'no-store'}).then(me=>{if(me.eventSchedulesEnabled)void calendar();else hideCalendar();if(actor&&(!me.eventScheduleBuilderEnabled||identity(me)!==actor)){clear();render();}}).catch(()=>{hideCalendar();if(actor){clear();render();}});},30000);
 void run(refresh);
})();
