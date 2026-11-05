(() => {
  'use strict';
  const {api}=window.HDS,$=id=>document.getElementById(id),base='/api/dynamic-challenges';
  let actor=null,model=null,caps={},review=null,busy=false,epoch=0;
  const message=text=>$('dynamic-status').textContent=text;
  const identity=me=>me?.loggedIn&&/^\d{17}$/.test(String(me.user?.steam_id||''))?String(me.user.steam_id):null;
  const writable=()=>actor&&model&&!caps.readOnly&&(caps.enabled||caps.managementAvailable);
  const running=()=>caps.enabled&&model?.enabled;
  const canChoose=kind=>writable()&&(running()||(kind==='location'?model.location?.enabled:model.participating));
  const canConfirm=()=>writable()&&review&&(running()||review.body.selected===false);
  const reviewedRevision=()=>review?.kind==='location'?model?.location?.revision:model?.revision;
  function clear(){actor=null;model=null;review=null;$('dynamic-list').replaceChildren();}
  function render(){
    $('dynamic-challenges').hidden=!caps.enabled&&!model?.participating&&!model?.location?.enabled&&!review;
    $('dynamic-details').hidden=!model;
    $('dynamic-participation').textContent=model?.participating?(running()?'You are participating.':'Challenge tracking is paused. You can stop and delete saved progress.'):'You are not participating.';
    $('dynamic-preview').textContent=caps.readOnly?'This preview is read-only.':'';
    $('dynamic-choice').textContent=model?.participating?'Review stop tracking':'Review participation';
    $('dynamic-choice').disabled=busy||!canChoose()||Boolean(review);
    $('dynamic-location').hidden=!model||(!model.location?.available&&!model.location?.enabled);
    $('dynamic-location-status').textContent=model?.location?.enabled?(model.location.available?'Location tracking is on for separately reviewed map goals.':'Location tracking is paused until reviewed map rules are available. You can stop it and delete its progress.'):'Location tracking is off. Joining the main challenge rotation does not enable it.';
    $('dynamic-location-choice').textContent=model?.location?.enabled?'Review stopping location tracking':'Review location tracking';
    $('dynamic-location-choice').disabled=busy||!canChoose('location')||Boolean(review)||!model?.participating;
    $('dynamic-refresh').disabled=busy;
    $('dynamic-review').hidden=!review;
    const consent=review?.kind==='location'?(review.body.selected?
      'Enable separate location tracking for observed travel and Highlands visits. Only the last position is stored; it expires after two minutes and is removed on the next maintenance pass. Coordinate-free progress receipts expire after 35 days. No journey history is read or created, and no coins are issued.':
      'Stop location tracking and erase its last position and progress receipts. Rejoining starts fresh. A minimal consent revision and request receipt remain to prevent old requests re-enabling tracking.'):(review?.body.selected?
      'Start tracking these challenges from new gameplay observations. Challenge tracking keeps species, growth and observation times for up to 35 days. Late death reports can correct progress. No coin rewards or streak bonuses are enabled.':
      'Stop challenge tracking and delete its saved gameplay progress, including location progress. Rejoining starts fresh. Separate staff event records are retained. A minimal choice revision and request receipt remain to prevent old requests restoring participation.');
    $('dynamic-review-text').textContent=review?consent+(review.uncertain?' The reply was not confirmed. Refresh or explicitly retry this saved request.':review.body.expectedRevision!==reviewedRevision()?' Your choice changed elsewhere. Cancel this review and review the latest state.':''):'';
    $('dynamic-confirm').textContent=review?.uncertain?'Retry saved request':'Confirm participation choice';
    $('dynamic-confirm').disabled=busy||!canConfirm()||review.actor!==actor||(!review.uncertain&&review.body.expectedRevision!==reviewedRevision());
    $('dynamic-cancel').disabled=busy;
    const list=$('dynamic-list');list.replaceChildren();
    for(const challenge of model?.challenges||[]){
      const card=document.createElement('article');card.className='quest-stat-card';
      const heading=document.createElement('h3');heading.textContent=challenge.title;
      const cadence=document.createElement('small');cadence.textContent=challenge.cadence==='weekly'?'THIS WEEK':'TODAY';
      const detail=document.createElement('p');
      detail.textContent=challenge.metric==='observed_seconds'?`${Math.floor(challenge.progress/60)} / ${challenge.target/60} observed minutes in one connected life segment.`:
        challenge.metric==='species'?`${challenge.progress} / ${challenge.target} species observed.`:
        challenge.metric==='confirmed_attendance'?`${challenge.progress} / ${challenge.target} event attendance confirmed by staff. RSVPs and registrations do not count.`:
        challenge.metric==='observed_metres'?`${(Math.floor(challenge.progress/10)/100).toFixed(2)} / 12 km of observed connected displacement.`:
        challenge.metric==='highlands_visit'?(challenge.completed?'Highlands visit observed.':'Two consecutive observations inside the reviewed Highlands boundary are required.'):
        challenge.completed?'Juvenile-to-adult herbivore growth observed.':'Observe the same herbivore as a juvenile and then an adult.';
      const reset=document.createElement('p');reset.textContent=`Resets ${new Date(challenge.endsAt).toLocaleString('en-AU',{timeZone:'Australia/Brisbane'})} Brisbane time.`;
      const bar=document.createElement('progress');bar.max=challenge.target;bar.value=challenge.progress;bar.setAttribute('aria-label',challenge.title+' progress');
      card.append(cadence,heading,detail,bar,reset);list.append(card);
    }
  }
  async function read(token){
    const [cap,me]=await Promise.all([api(base+'/capabilities',{cache:'no-store'}),api('/api/me',{cache:'no-store'})]);
    if(token!==epoch)return;
    caps=cap;const who=identity(me);
    if(!caps.enabled&&!caps.managementAvailable){clear();return;}
    if(who!==actor){clear();actor=who;}
    if(!actor){clear();message('Sign in with Steam to view challenge progress.');return;}
    const result=await api(base+'/me',{cache:'no-store'});
    const checked=identity(await api('/api/me',{cache:'no-store'}));
    if(token!==epoch)return;
    if(checked!==who){clear();message('Your account changed. Refresh to continue.');return;}
    model=result;message(!running()?'Challenge tracking is paused. Existing participants can stop and delete saved progress.':model.participating?'Tracking new gameplay observations. Rewards are disabled.':'Participation is optional. Review the tracking details before joining.');
  }
  async function run(fn){
    if(busy)return;
    busy=true;const token=++epoch;render();
    try {await fn(token);}
    catch(error){if(token===epoch){clear();message(error.status===401?'Sign in with Steam to continue.':'Challenge progress is unavailable. Refresh to try again.');}}
    finally {if(token===epoch){busy=false;render();}}
  }
  const refresh=()=>run(read);
  $('dynamic-refresh').addEventListener('click',refresh);
  $('dynamic-choice').addEventListener('click',()=>{
    if(!canChoose()||busy||review)return;
    review={actor,body:{selected:!model.participating,expectedRevision:model.revision,requestKey:crypto.randomUUID()},uncertain:false};render();
  });
  $('dynamic-location-choice').addEventListener('click',()=>{
    if(!canChoose('location')||busy||review||!model.participating)return;
    review={kind:'location',actor,body:{selected:!model.location.enabled,expectedRevision:model.location.revision,requestKey:crypto.randomUUID()},uncertain:false};render();
  });
  $('dynamic-cancel').addEventListener('click',()=>{if(!busy){review=null;render();}});
  $('dynamic-confirm').addEventListener('click',()=>run(async token=>{
    if(!canConfirm())return;
    const saved=review;
    const me=identity(await api('/api/me',{cache:'no-store'}));
    if(me!==saved.actor){clear();message('Your account changed. Refresh to continue.');return;}
    // Re-read deployment capability before sending the reviewed mutation.
    caps=await api(base+'/capabilities',{cache:'no-store'});
    if(!canConfirm()){message('This participation choice is unavailable while tracking is paused or this preview is read-only.');return;}
    try {
      const result=await api(base+(saved.kind==='location'?'/location':'/participation'),{method:'POST',body:JSON.stringify(saved.body)});
      const checked=identity(await api('/api/me',{cache:'no-store'}));
      if(token!==epoch)return;
      if(checked!==saved.actor){clear();message('Your account changed. Refresh to continue.');return;}
      if(saved.kind==='location'){
        await read(token);if(actor!==saved.actor)return;review=null;message(result.enabled?(result.available?'Separate location tracking is on. New observations can count.':'Location tracking remains opted in but is paused until reviewed map rules are available.'):'Location tracking is off and its last position and progress receipts have been deleted.');
      }else{model=result;review=null;message(result.participating?'Challenge tracking is on. New gameplay observations can count.':'Challenge tracking is off and its saved gameplay progress has been deleted.');}
    } catch(error){
      const uncertain=!error.status||error.status>=500;
      if(uncertain){saved.uncertain=true;review=saved;}else review=null;
      // Reads may recover the current choice, but never automatically repeat a POST.
      try {await read(token);}
      catch(readError){
        if(!uncertain||[401,403].includes(readError.status))throw readError;
        model=null;message('The reply and refresh were not confirmed. Refresh when connected to recover your current choice.');return;
      }
      message(uncertain?'The reply was not confirmed. Refresh or retry the saved request.':error.status===409?'Your participation changed. Review the current choice before continuing.':error.message);
    }
  }));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
  window.addEventListener('focus',refresh);
  setInterval(()=>{if(!document.hidden)void refresh();},30000);
  void refresh();
})();
