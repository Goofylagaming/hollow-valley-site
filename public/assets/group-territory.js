(() => {
  const {api,loadMe}=window.HDS,get=id=>document.getElementById(id);
  let link=null,writable=false,busy=false,active=false,generation=0,expectedGroup;
  function controls(){
    get('hq-territory-choice').disabled=busy||!writable||!link?.canEdit;
    get('hq-territory-save').disabled=busy||!writable||!link?.canEdit;
    get('hq-territory-refresh').disabled=busy;
  }
  function clear(){
    link=null;get('hq-territory-current').textContent='';get('hq-territory-choice').replaceChildren();
    get('hq-territory-form').hidden=true;get('hq-battles').replaceChildren();controls();
  }
  async function refresh(epoch){
    const [state,history]=await Promise.all([api('/api/group-headquarters/territory-link'),api('/api/group-headquarters/battles')]);
    if(epoch!==generation)return;
    if(state.groupId!==history.groupId||(expectedGroup!==undefined&&state.groupId!==expectedGroup))throw new Error('Group membership changed. Refresh Territory records.');
    link=state;
    get('hq-territory-current').textContent=state.territoryGroupId===null?'No Territory Wars group linked.':
      state.active?`Linked Territory Wars group #${state.territoryGroupId}.`:'The saved link is inactive because group leadership has changed.';
    get('hq-territory-form').hidden=!state.canEdit;
    const choices=get('hq-territory-choice');choices.replaceChildren();choices.add(new Option('No link',''));
    for(const group of state.choices)choices.add(new Option(group.name,String(group.id)));
    if(state.territoryGroupId!==null&&!state.choices.some(group=>group.id===state.territoryGroupId))choices.add(new Option('Saved inactive link',String(state.territoryGroupId)));
    choices.value=state.territoryGroupId===null?'':String(state.territoryGroupId);
    const rows=get('hq-battles');rows.replaceChildren();
    for(const battle of history.battles){
      const item=document.createElement('li');
      item.textContent=`Battle #${battle.attackId} · Event #${battle.eventId} · ${battle.side==='attacker'?'Attacking':'Defending'} · ${battle.result==='win'?'Win':'Loss'} · ${new Date(battle.resolvedAt).toLocaleString()}`;
      rows.append(item);
    }
    if(!history.battles.length){const item=document.createElement('li');item.textContent='No verified battle records available.';rows.append(item);}
    get('hq-territory-status').textContent=writable?'':'This preview is read-only.';
  }
  async function action(save=false){
    if(busy)return;
    const epoch=generation,state=link,target=get('hq-territory-choice').value;
    busy=true;controls();
    try{
      if(save)await api('/api/group-headquarters/territory-link',{method:'POST',body:JSON.stringify({territoryGroupId:target?Number(target):null,expectedRevision:state.revision,expectedGroupId:state.groupId})});
      await refresh(epoch);
    }catch(error){
      if(epoch===generation){clear();get('hq-territory-status').textContent=error.message;}
    }finally{if(epoch===generation){busy=false;controls();}}
  }
  get('hq-territory-form').addEventListener('submit',event=>{event.preventDefault();if(writable&&link?.canEdit)action(true);});
  get('hq-territory-refresh').addEventListener('click',()=>action());
  window.addEventListener('hv:group-state',event=>{
    if(!active)return;
    expectedGroup=event.detail?.groupId??null;generation++;busy=false;clear();
    if(expectedGroup!==null)action();
  });
  (async()=>{
    try{
      const capability=await api('/api/group-headquarters/capabilities');
      if(!capability.enabled||!(await loadMe())?.user?.steam_id)return;
      active=true;writable=!capability.readOnly;get('hq-territory').hidden=false;await action();
    }catch(error){get('hq-territory-status').textContent=error.message;}
  })();
})();
