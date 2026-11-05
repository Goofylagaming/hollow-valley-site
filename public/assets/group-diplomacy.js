(() => {
  const {api,loadMe}=window.HDS,get=id=>document.getElementById(id),base='/api/group-diplomacy';
  const labels={propose_alliance:'Propose alliance',accept_alliance:'Accept alliance',decline_alliance:'Decline alliance',end_alliance:'End alliance / withdraw proposal',declare_rival:'Declare rival',clear_rival:'Clear our rivalry'};
  let caps={},model=null,selected=null,review=null,searchResults=[],ready=false,busy=null,active=false,epoch=0,expectedGroup;
  const status=text=>get('diplomacy-status').textContent=text;
  const canManage=()=>ready&&model?.canManage&&selected?.canManage&&!caps.readOnly&&!model.group.closing&&!selected.closing&&selected.otherGroup.status==='active';
  function options(){
    if(!selected||selected.otherGroup.status!=='active')return [];
    const actions=[];
    if(selected.alliance==='none'&&!selected.outgoingRival&&!selected.incomingRival)actions.push('propose_alliance');
    if(selected.alliance==='pending')actions.push(...(selected.proposalFrom===model.group.id?['end_alliance']:['accept_alliance','decline_alliance']));
    if(selected.alliance==='active')actions.push('end_alliance');
    actions.push(selected.outgoingRival?'clear_rival':'declare_rival');return actions;
  }
  function controls(){
    const locked=Boolean(busy);get('diplomacy-refresh').disabled=locked;
    get('diplomacy-search').disabled=locked||!ready;get('diplomacy-search-submit').disabled=locked||!ready;
    get('diplomacy-more').hidden=model?.nextRelationId==null;get('diplomacy-more').disabled=locked||!ready;
    get('diplomacy-action').disabled=locked||!canManage()||Boolean(review);get('diplomacy-review-button').disabled=locked||!canManage()||Boolean(review);
    get('diplomacy-confirm').disabled=locked||!canManage()||!review||review.groupId!==model.group.id||review.targetId!==selected.otherGroup.id||(!review.uncertain&&review.body.expectedRevision!==selected.revision);
    get('diplomacy-discard').disabled=locked;
    document.querySelectorAll('#diplomacy-relations button,#diplomacy-search-results button').forEach(button=>button.disabled=locked||!ready);
  }
  function summary(row){
    if(row.otherGroup.status!=='active')return 'Closed group · historical relationship';
    if(row.effectiveAlliance)return 'Allied';
    if(row.alliance==='pending')return row.proposalFrom===model.group.id?'Alliance proposal sent':'Alliance proposal received';
    if(row.outgoingRival&&row.incomingRival)return 'Both groups declare rivalry';
    if(row.outgoingRival)return 'Your group declares rivalry';if(row.incomingRival)return 'Their group declares rivalry';return 'Neutral';
  }
  function groupButton(target,list,text){const li=document.createElement('li'),button=document.createElement('button');button.type='button';button.className='small-button';button.textContent=text;
    button.addEventListener('click',()=>void run('select',async token=>{review=null;selected=null;render();await hydrate(token,target);}));li.append(button);list.append(li);}
  function render(){
    const relations=get('diplomacy-relations');relations.replaceChildren();
    for(const row of model?.relations||[])groupButton(row.otherGroup.id,relations,`${row.otherGroup.name} · ${summary(row)}`);
    if(model&&!model.relations.length){const li=document.createElement('li');li.textContent='No recorded relationships yet.';relations.append(li);}
    const results=get('diplomacy-search-results');results.replaceChildren();for(const group of searchResults)groupButton(group.id,results,`View ${group.name}`);
    get('diplomacy-detail').hidden=!selected;
    get('diplomacy-peer').textContent=selected?.otherGroup.name||'';
    get('diplomacy-alliance').textContent=selected?summary(selected):'';
    get('diplomacy-rivalry').textContent=selected?`Your rivalry declaration: ${selected.outgoingRival?'Rival':'None'}. Their declaration: ${selected.incomingRival?'Rival':'None'}.`:'';
    get('diplomacy-authority').textContent=caps.readOnly?'This preview is read-only.':model?.group.closing?'Resolve the group closure check before changing relationships.':!model?.canManage?'The current group owner can change relationships.':'';
    const choice=get('diplomacy-action'),previous=choice.value;choice.replaceChildren();for(const action of options())choice.add(new Option(labels[action],action));if(options().includes(previous))choice.value=previous;
    get('diplomacy-action-form').hidden=!model?.canManage||!selected||selected.otherGroup.status!=='active';
    get('diplomacy-review').hidden=!review;
    get('diplomacy-confirm').textContent=review?.uncertain?'Retry saved request':'Confirm relationship change';
    get('diplomacy-review-text').textContent=review?`${labels[review.body.action]}: ${review.ownName} → ${review.targetName}.${review.body.action==='declare_rival'?' This ends any alliance or pending alliance proposal.':''}${review.uncertain?' The reply was not confirmed. Refresh or explicitly retry this same saved request.':review.body.expectedRevision!==selected?.revision?' The relationship changed. Discard this review and review the current state.':''}`:'';
    const record=selected?.headToHead;
    get('diplomacy-score').textContent=!selected?'':!record?.available?'Verified Territory history is unavailable.':!record.totals.battles?'No verified shared battles recorded.':`${model.group.name} ${record.totals.wins}–${record.totals.losses} ${selected.otherGroup.name} · ${record.totals.battles} recorded battles, all time`;
    const battles=get('diplomacy-battles');battles.replaceChildren();for(const battle of record?.battles||[]){const li=document.createElement('li');li.textContent=`${battle.result==='win'?'Win':'Loss'} · Battle #${battle.attackId} · ${new Date(battle.resolvedAt).toLocaleString()}`;battles.append(li);}
    const history=get('diplomacy-history');history.replaceChildren();for(const row of selected?.history||[]){const li=document.createElement('li');li.textContent=`${row.actorGroupId===model.group.id?model.group.name:selected.otherGroup.name}: ${labels[row.action]} · ${new Date(row.at).toLocaleString()}`;history.append(li);}
    if(selected&&!selected.history.length){const li=document.createElement('li');li.textContent='No relationship changes recorded.';history.append(li);}controls();
  }
  function clear(){model=null;selected=null;review=null;searchResults=[];ready=false;render();get('group-diplomacy').hidden=true;}
  async function hydrate(token,targetId=selected?.otherGroup.id){
    const [capability,state]=await Promise.all([api(`${base}/capabilities`),api(base)]);if(token!==epoch)return;
    if(!capability.enabled){clear();return;}caps=capability;
    if(expectedGroup!==undefined&&state.group.id!==expectedGroup){clear();return;}
    if(model&&state.group.id!==model.group.id){clear();return;}
    model=state;ready=true;if(!model.canManage)review=null;get('group-diplomacy').hidden=false;
    if(targetId){const detail=await api(`${base}/relations/${targetId}`);if(token!==epoch)return;
      if(detail.groupId!==model.group.id||detail.otherGroup.id!==targetId){clear();throw new Error('Group context changed. Refresh relationships.');}selected=detail;
    }render();
  }
  async function run(kind,fn){
    if(busy)return;const token=++epoch;busy=kind;controls();
    try{await fn(token);}
    catch(error){if(token!==epoch)return;if([401,403,404,503].includes(error.status)){clear();}else{ready=false;render();}status(error.message||'Relationships could not be verified.');}
    finally{if(token===epoch){busy=null;controls();}}
  }
  get('diplomacy-refresh').addEventListener('click',()=>void run('refresh',async token=>{await hydrate(token);if(token===epoch)status(caps.readOnly?'This preview is read-only.':'Relationships refreshed.');}));
  get('diplomacy-search-form').addEventListener('submit',event=>{event.preventDefault();if(!ready)return;const query=get('diplomacy-search').value.trim();void run('search',async token=>{
    const result=await api(`${base}/groups?q=${encodeURIComponent(query)}`);if(token!==epoch)return;
    if(result.groupId!==model.group.id){clear();return;}searchResults=result.groups;render();status(result.groups.length?'Choose a group to view its relationship.':'No matching active groups.');
  });});
  get('diplomacy-more').addEventListener('click',()=>void run('more',async token=>{const cursor=model.nextRelationId;const result=await api(`${base}?afterRelationId=${cursor}`);if(token!==epoch)return;if(result.group.id!==model.group.id){clear();return;}model={...result,relations:[...model.relations,...result.relations]};render();}));
  get('diplomacy-action-form').addEventListener('submit',event=>{event.preventDefault();if(!canManage()||review)return;const action=get('diplomacy-action').value;if(!options().includes(action))return;
    review={groupId:model.group.id,targetId:selected.otherGroup.id,ownName:model.group.name,targetName:selected.otherGroup.name,uncertain:false,body:{expectedGroupId:model.group.id,expectedRevision:selected.revision,action,requestId:crypto.randomUUID()}};render();
  });
  get('diplomacy-discard').addEventListener('click',()=>{if(!busy){review=null;render();}});
  get('diplomacy-confirm').addEventListener('click',()=>{
    if(get('diplomacy-confirm').disabled||!review)return;const saved=review;
    void run('write',async token=>{
      try{const result=await api(`${base}/relations/${saved.targetId}`,{method:'POST',body:JSON.stringify(saved.body)});if(token!==epoch)return;
        if(result.groupId!==saved.groupId||result.otherGroup.id!==saved.targetId)throw new Error('The relationship response could not be verified.');selected=result;review=null;await hydrate(token,saved.targetId);if(token===epoch)status('Relationship updated.');
      }catch(error){if(token!==epoch)return;
        if(error.status&&error.status<500){review=null;}else{saved.uncertain=true;review=saved;}
        try{await hydrate(token,saved.targetId);}catch(readError){if(token===epoch){if([401,404].includes(readError.status))clear();else{ready=false;render();}}}
        if(token===epoch){render();status(error.message||'The reply could not be confirmed. Refresh or retry the saved request.');}
      }
    });
  });
  window.addEventListener('hv:group-state',event=>{
    const next=event.detail?.groupId??null;expectedGroup=next;if(!active)return;
    if(model?.group.id===next){if(!busy)void run('refresh',token=>hydrate(token));return;}
    epoch++;busy=null;clear();if(next!==null)void run('refresh',token=>hydrate(token));
  });
  (async()=>{try{const [capability,me]=await Promise.all([api(`${base}/capabilities`),loadMe()]);if(!capability.enabled||!/^\d{17}$/.test(String(me?.user?.steam_id||'')))return;caps=capability;active=true;await run('refresh',token=>hydrate(token));}catch{clear();}})();
})();
