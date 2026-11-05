(() => {
  'use strict';
  const {api}=window.HDS,$=id=>document.getElementById('event-template-'+id),base='/api/event-templates';
  let actor=null,caps={},current=null,review=null,busy=false,next=null,historyNext=null,epoch=0;
  const identity=me=>me?.loggedIn&&Number.isSafeInteger(me.user?.id)&&/^\d{17}$/.test(String(me.user?.steam_id||''))?me.user.id+':'+me.user.steam_id:null;
  const writable=()=>actor&&caps.enabled&&!caps.readOnly;
  const message=text=>$('status').textContent=text;
  function reset(){actor=null;current=null;review=null;next=null;historyNext=null;$('form').reset();$('list').replaceChildren();$('history').replaceChildren();$('summary').replaceChildren();}
  function render(){
    $('panel').setAttribute('aria-busy',String(busy));
    $('panel').hidden=!actor||!caps.enabled;
    $('preview').textContent=caps.readOnly?'This preview is read-only.':'';
    $('selected').textContent=current?`${current.definition.title} · revision ${current.revision} · ${current.state}`:'New template';
    const frozen=busy||Boolean(review)||!writable()||current?.state==='archived';
    for(const control of $('form').elements)control.disabled=frozen;
    $('new').disabled=busy||Boolean(review)||!writable();$('archive').disabled=busy||Boolean(review)||!writable()||!current||current.state==='archived';
    $('refresh').disabled=busy||Boolean(review);$('archived').disabled=busy||Boolean(review);
    $('more').hidden=!next;$('more').disabled=busy||Boolean(review);
    $('history-more').hidden=!historyNext;$('history-more').disabled=busy||Boolean(review);
    for(const button of $('list').querySelectorAll('button'))button.disabled=busy||Boolean(review);
    $('review').hidden=!review;$('confirm').disabled=busy||!review||!writable()||review.actor!==actor;
    $('confirm').textContent=review?.uncertain?'Retry saved template request':'Confirm template change';$('cancel').disabled=busy;
  }
  async function check(){const me=await api('/api/me',{cache:'no-store'}),who=identity(me);if(who!==actor||me.eventTemplateBuilderEnabled!==true||!me.user?.is_admin){reset();message('Your account or staff access changed. Refresh to continue.');throw new Error('Account or staff access changed');}return who;}
  async function run(fn){if(busy)return;busy=true;const token=++epoch;render();try{await fn(token);}catch(e){
    if(token!==epoch)return;
    if([401,403].includes(e.status)){reset();caps={};message('Current staff access is required.');}
    else message(e.message||'Templates are unavailable. Refresh to try again.');
  }finally{if(token===epoch){busy=false;render();}}}
  function populate(item){
    current=item;$('form').reset();$('history').replaceChildren();historyNext=null;
    if(item)for(const key of ['kind','title','description','rules','durationMinutes','capacity','teamCount'])$('form').elements.namedItem(key).value=item.definition[key];
  }
  function showItems(items){for(const item of items){const li=document.createElement('li'),button=document.createElement('button');button.type='button';button.className='small-button';button.textContent=`${item.definition.title} · ${caps.kinds[item.definition.kind]} · r${item.revision} · ${item.state}`;button.addEventListener('click',()=>void run(async()=>{
    await check();const result=await api(base+'/'+encodeURIComponent(item.id),{cache:'no-store'});await check();populate(result);await loadHistory();message('Loaded the saved template. Review changes before saving.');
  }));li.append(button);$('list').append(li);}}
  async function loadList(more=false){await check();const page=await api(base+'?archived='+($('archived').checked?'1':'0')+(more&&next?'&before='+next:''),{cache:'no-store'});await check();if(!more)$('list').replaceChildren();showItems(page.items);next=page.next;}
  async function loadHistory(more=false){
    if(!current)return;await check();
    const page=await api(base+'/'+encodeURIComponent(current.id)+'/history'+(more&&historyNext?'?before='+historyNext:''),{cache:'no-store'});await check();
    if(!more)$('history').replaceChildren();
    for(const item of page.items){
      const li=document.createElement('li'),details=document.createElement('details'),summary=document.createElement('summary');
      summary.textContent=`Revision ${item.revision}: ${item.action} by ${item.actorSteamId} · ${new Date(item.at).toLocaleString('en-AU',{timeZone:'Australia/Brisbane'})} Brisbane · ${item.definition.title}`;
      details.append(summary);
      for(const [label,value]of [['Event type',caps.kinds[item.definition.kind]],['Description',item.definition.description],['Rules',item.definition.rules],['Duration',item.definition.durationMinutes+' minutes'],['Capacity',item.definition.capacity],['Teams',item.definition.teamCount]]){const p=document.createElement('p');p.textContent=label+': '+value;details.append(p);}
      li.append(details);$('history').append(li);
    }
    historyNext=page.next;
  }
  async function refresh(){const me=await api('/api/me',{cache:'no-store'}),who=identity(me);if(!who||me.eventTemplateBuilderEnabled!==true){reset();caps={};return;}if(actor!==who){reset();actor=who;}
    caps=await api(base+'/capabilities',{cache:'no-store'});await check();if(!caps.enabled){reset();return;}
    const select=$('form').elements.namedItem('kind');select.replaceChildren();for(const [value,label]of Object.entries(caps.kinds)){const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);}
    populate(null);await loadList();message('Templates are staff plans. Saving does not schedule or start an event.');
  }
  function prepare(action){if(!writable()||busy||review)return;if(action==='archive'&&(!current||current.state==='archived'))return;
    const form=$('form');if(action==='save'&&!form.reportValidity())return;
    const body={action,expectedRevision:current?.revision||0,requestKey:crypto.randomUUID()};
    if(action==='save'){body.details={};for(const name of ['kind','title','description','rules'])body.details[name]=form.elements.namedItem(name).value;for(const name of ['durationMinutes','capacity','teamCount'])body.details[name]=Number(form.elements.namedItem(name).value);}
    review={actor,id:current?.id||crypto.randomUUID(),body,uncertain:false};$('summary').replaceChildren();
    const title=document.createElement('h4');title.textContent=action==='archive'?'Archive this template':current?'Save a new template revision':'Create this template';$('summary').append(title);
    const content=body.details||current.definition;for(const [label,value]of [['Event type',caps.kinds[content.kind]],['Title',content.title],['Description',content.description],['Rules',content.rules],['Duration',content.durationMinutes+' minutes'],['Capacity',content.capacity],['Teams',content.teamCount]]){const p=document.createElement('p');p.textContent=label+': '+value;$('summary').append(p);}
    message('Review these exact details before confirming. No event will be started.');render();
  }
  $('form').addEventListener('submit',event=>{event.preventDefault();prepare('save');});$('archive').addEventListener('click',()=>prepare('archive'));
  $('new').addEventListener('click',()=>{if(busy||review||!writable())return;populate(null);message('Enter a new staff event plan.');render();});
  $('cancel').addEventListener('click',()=>{if(busy)return;review=null;$('summary').replaceChildren();message('Review closed. Refresh the list before recreating a request with an unconfirmed reply.');render();});
  $('refresh').addEventListener('click',()=>void run(refresh));$('archived').addEventListener('change',()=>void run(()=>loadList()));$('more').addEventListener('click',()=>void run(()=>loadList(true)));$('history-more').addEventListener('click',()=>void run(()=>loadHistory(true)));
  $('confirm').addEventListener('click',()=>void run(async()=>{
    if(!review||!writable())return;const saved=review;await check();caps=await api(base+'/capabilities',{cache:'no-store'});if(!writable()){message('Template changes are unavailable in this preview.');return;}
    let result;
    try{result=await api(base+'/'+encodeURIComponent(saved.id),{method:'POST',body:JSON.stringify(saved.body)});}
    catch(e){if(!e.status||e.status>=500){saved.uncertain=true;message('The reply was not confirmed. Retry the saved template request to recover its result.');return;}if(e.status===409){review=null;message('This template changed. Load its current revision before reviewing again.');await loadList();return;}throw e;}
    await check();review=null;populate(result.current);await loadList();await loadHistory();
    message(`Saved revision ${result.saved.revision}.`+(result.current.revision!==result.saved.revision?' A later revision is now displayed.':'')+' No event was started.');
  }));
  window.addEventListener('focus',()=>{if(!busy)void run(async()=>{await check();caps=await api(base+'/capabilities',{cache:'no-store'});});});
  void run(refresh);
})();
