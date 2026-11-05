(() => {
  'use strict';
  const {api}=window.HDS,$=id=>document.getElementById(id),base='/api/admin/challenge-attendance';
  let actor=null,caps={},saved=null,busy=false,ready=false;
  const message=value=>$('attendance-evidence-status').textContent=value;
  const identity=me=>me?.loggedIn&&me.user?.is_admin&&/^\d{17}$/.test(String(me.user?.steam_id||''))?String(me.user.steam_id):null;
  function forget(){saved=null;if(location.hash.startsWith('#attendance-review='))history.replaceState(null,'',location.pathname+location.search);}
  function clear(){actor=null;caps={};forget();ready=false;$('attendance-evidence-form').reset();}
  function controls(){
    const locked=busy||!ready||caps.readOnly;
    $('attendance-evidence-panel').hidden=!ready;
    $('attendance-evidence-refresh').disabled=busy;
    for(const input of $('attendance-evidence-form').elements)input.disabled=locked||Boolean(saved);
    $('attendance-evidence-review').hidden=!saved;
    $('attendance-evidence-confirm').disabled=locked||!saved;
    $('attendance-evidence-cancel').disabled=busy;
    $('attendance-evidence-confirm').textContent=saved?.uncertain?'Retry saved confirmation':'Confirm reviewed evidence';
    $('attendance-evidence-preview').textContent=caps.readOnly?'This preview is read-only.':'';
    const content=$('attendance-evidence-summary');content.replaceChildren();
    if(saved){
      const review=saved.review;
      const rows=[['Action',review.body.action==='revoke'?'Revoke attendance evidence':'Confirm attendance evidence'],['Player Steam ID',review.body.steamId],['Official event',review.event.title],['Event ID',review.event.eventId],['Schedule',review.event.startTime+' to '+review.event.endTime],['Attendance time',new Date(review.body.occurredAt).toISOString()],['Current record',review.current.state+' · revision '+review.body.expectedRevision],['Supporting message',review.body.evidenceUrl],['Staff reason',review.body.reason]];
      for(const[label,value]of rows){const p=document.createElement('p'),strong=document.createElement('strong');strong.textContent=label+': ';p.append(strong,document.createTextNode(value));content.append(p);}
      if(saved.uncertain){const p=document.createElement('p');p.textContent='The reply was not confirmed. Check the current record or explicitly retry this same saved review. No automatic confirmation will be sent.';content.append(p);}
    }
  }
  async function authorize(){
    const who=identity(await api('/api/me',{cache:'no-store'}));
    if(!who){clear();return false;}
    if(actor&&who!==actor){clear();message('The staff account changed. Review the evidence again.');}
    actor=who;caps=await api(base+'/capabilities',{cache:'no-store'});ready=caps.enabled;
    if(!ready)forget();
    return ready;
  }
  async function run(fn){
    if(busy)return;busy=true;controls();
    try{await fn();}
    catch(error){
      if([401,403].includes(error.status)){clear();message('Current staff access is required.');}
      else if(error.status===404){forget();message('The saved review is unavailable to this account. Create a new review.');}
      else message(error.message||'Attendance evidence is unavailable. Refresh to try again.');
    }finally{busy=false;controls();}
  }
  const refresh=()=>run(async()=>{
    if(!await authorize())return;
    if(!saved){
      const id=location.hash.match(/^#attendance-review=([a-f0-9-]{36})$/)?.[1];
      if(id){
        const who=actor,review=await api(base+'/reviews/'+encodeURIComponent(id),{cache:'no-store'});
        if(!await authorize()||actor!==who)return;
        saved={review,actor:who,uncertain:true};
      }
    }
    if(saved){
      const reviewedActor=actor;
      const record=await api(base+'/record?'+new URLSearchParams({eventId:saved.review.body.eventId,steamId:saved.review.body.steamId}),{cache:'no-store'});
      if(!await authorize()||actor!==reviewedActor)return;
      message('Current record: '+record.state+' · revision '+record.revision+'. The saved review remains fixed.');
    }else message('Review evidence before confirming. This process never issues coins.');
  });
  $('attendance-evidence-refresh').addEventListener('click',refresh);
  $('attendance-evidence-form').addEventListener('submit',event=>{
    event.preventDefault();void run(async()=>{
      if(!await authorize()||caps.readOnly||saved)return;
      const reviewedActor=actor,action=$('attendance-evidence-action').value;
      const raw=$('attendance-evidence-time').value;
      const occurredAt=action==='confirm'?Date.parse(raw+':00+10:00'):undefined;
      if(action==='confirm'&&(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)||!Number.isSafeInteger(occurredAt)))throw new Error('Choose the actual attendance time in Brisbane.');
      const body={eventId:$('attendance-evidence-event').value.trim(),steamId:$('attendance-evidence-player').value.trim(),action,occurredAt,evidenceUrl:$('attendance-evidence-proof').value.trim(),reason:$('attendance-evidence-reason').value.trim()};
      const review=await api(base+'/reviews',{method:'POST',body:JSON.stringify(body)});
      if(!await authorize()||actor!==reviewedActor)return;
      saved={review,actor:reviewedActor,uncertain:false};history.replaceState(null,'',location.pathname+location.search+'#attendance-review='+encodeURIComponent(review.id));message('Review the frozen details below. Nothing has been confirmed yet.');
    });
  });
  $('attendance-evidence-cancel').addEventListener('click',()=>{if(!busy){const uncertain=saved?.uncertain;forget();message(uncertain?'Saved review dismissed. Its earlier confirmation may have completed. Review the current record before making another change.':'Review dismissed. No attendance confirmation was sent.');controls();}});
  $('attendance-evidence-confirm').addEventListener('click',()=>void run(async()=>{
    const pending=saved;if(!pending||!await authorize()||caps.readOnly||actor!==pending.actor)return;
    try{
      const result=await api(base+'/reviews/'+encodeURIComponent(pending.review.id)+'/confirm',{method:'POST',body:'{}'});
      if(!await authorize()||actor!==pending.actor)return;
      forget();message('Attendance evidence is '+result.state+' · revision '+result.revision+'. No coins were issued.');
    }catch(error){
      if(!error.status||error.status>=500){pending.uncertain=true;saved=pending;message('The reply was not confirmed. Refresh or explicitly retry the saved review.');}
      else {forget();throw error;}
    }
  }));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
  window.addEventListener('focus',refresh);
  window.addEventListener('hashchange',refresh);
  setInterval(()=>{if(!document.hidden)void refresh();},30000);
  void refresh();
})();
