(() => {
  'use strict';
  const {api}=window.HDS,$=id=>document.getElementById(id),base='/api/dynamic-challenges';
  let actor=null,model=null,caps={},review=null,busy=false,epoch=0;
  const message=text=>$('dynamic-status').textContent=text;
  const identity=me=>me?.loggedIn&&/^\d{17}$/.test(String(me.user?.steam_id||''))?String(me.user.steam_id):null;
  const writable=()=>actor&&model&&!caps.readOnly&&caps.enabled;
  function clear(){actor=null;model=null;review=null;$('dynamic-list').replaceChildren();}
  function render(){
    $('dynamic-challenges').hidden=!caps.enabled;
    $('dynamic-details').hidden=!model;
    $('dynamic-participation').textContent=model?.participating?'You are participating.':'You are not participating.';
    $('dynamic-preview').textContent=caps.readOnly?'This preview is read-only.':'';
    $('dynamic-choice').textContent=model?.participating?'Review stop tracking':'Review participation';
    $('dynamic-choice').disabled=busy||!writable()||Boolean(review);
    $('dynamic-refresh').disabled=busy;
    $('dynamic-review').hidden=!review;
    $('dynamic-review-text').textContent=review?(review.body.selected?
      'Start tracking these challenges from new gameplay observations. No coin rewards or streak bonuses are enabled.':
      'Stop challenge tracking and delete its saved gameplay progress. Rejoining starts fresh. A minimal choice revision and request receipt remain to prevent old requests restoring participation.')+
      (review.uncertain?' The reply was not confirmed. Refresh or explicitly retry this saved request.':review.body.expectedRevision!==model?.revision?' Your choice changed elsewhere. Cancel this review and review the latest state.':''):'';
    $('dynamic-confirm').textContent=review?.uncertain?'Retry saved request':'Confirm participation choice';
    $('dynamic-confirm').disabled=busy||!writable()||!review||review.actor!==actor||(!review.uncertain&&review.body.expectedRevision!==model.revision);
    $('dynamic-cancel').disabled=busy;
    const list=$('dynamic-list');list.replaceChildren();
    for(const challenge of model?.challenges||[]){
      const card=document.createElement('article');card.className='quest-stat-card';
      const heading=document.createElement('h3');heading.textContent=challenge.title;
      const cadence=document.createElement('small');cadence.textContent=challenge.cadence==='weekly'?'THIS WEEK':'TODAY';
      const detail=document.createElement('p');
      detail.textContent=challenge.metric==='observed_seconds'?`${Math.floor(challenge.progress/60)} / ${challenge.target/60} observed minutes in one connected life segment.`:
        challenge.metric==='species'?`${challenge.progress} / ${challenge.target} species observed.`:
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
    if(!caps.enabled){clear();return;}
    if(who!==actor){clear();actor=who;}
    if(!actor){clear();message('Sign in with Steam to view challenge progress.');return;}
    const result=await api(base+'/me',{cache:'no-store'});
    const checked=identity(await api('/api/me',{cache:'no-store'}));
    if(token!==epoch)return;
    if(checked!==who){clear();message('Your account changed. Refresh to continue.');return;}
    model=result;message(model.participating?'Tracking new gameplay observations. Rewards are disabled.':'Participation is optional. Review the tracking details before joining.');
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
    if(!writable()||busy||review)return;
    review={actor,body:{selected:!model.participating,expectedRevision:model.revision,requestKey:crypto.randomUUID()},uncertain:false};render();
  });
  $('dynamic-cancel').addEventListener('click',()=>{if(!busy){review=null;render();}});
  $('dynamic-confirm').addEventListener('click',()=>run(async token=>{
    if(!writable()||!review)return;
    const saved=review;
    const me=identity(await api('/api/me',{cache:'no-store'}));
    if(me!==saved.actor){clear();message('Your account changed. Refresh to continue.');return;}
    // Re-read deployment capability before sending the reviewed mutation.
    caps=await api(base+'/capabilities',{cache:'no-store'});
    if(!writable()){message('Participation changes are unavailable in this preview.');return;}
    try {
      const result=await api(base+'/participation',{method:'POST',body:JSON.stringify(saved.body)});
      const checked=identity(await api('/api/me',{cache:'no-store'}));
      if(token!==epoch)return;
      if(checked!==saved.actor){clear();message('Your account changed. Refresh to continue.');return;}
      model=result;review=null;message(result.participating?'Challenge tracking is on. New gameplay observations can count.':'Challenge tracking is off and its saved gameplay progress has been deleted.');
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
