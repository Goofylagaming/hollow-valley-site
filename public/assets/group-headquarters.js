(() => {
  const { api, loadMe } = window.HDS;
  const get = id => document.getElementById(id);
  let profile = null, writable = false, busy = false, active = false;
  let generation=0,expectedGroup,draftRevision=0,refreshPending=false;
  function dirty(){return profile && (get('hq-description').value!==profile.description || get('hq-emblem-choice').value!==profile.emblem);}
  function clear(){
    profile=null;draftRevision=0;get('hq-name').textContent='';get('hq-current').textContent='';get('hq-emblem').textContent='';
    get('hq-description').value='';get('hq-emblem-choice').value='leaf';get('hq-editor').hidden=true;
    for(const id of ['hq-history','hq-ranks','hq-rank-history','hq-screenshots','hq-image-choice'])get(id).replaceChildren();
    controls();
  }
  function controls() {
    get('hq-description').disabled = busy || !writable || !profile?.canEdit;
    get('hq-emblem-choice').disabled = busy || !writable || !profile?.canEdit;
    get('hq-save').disabled = busy || !writable || !profile?.canEdit;
    get('hq-refresh').disabled = busy;
    get('hq-discard').disabled = busy || !dirty();
    get('hq-ranks').querySelectorAll('select,button').forEach(element => { element.disabled = busy || !writable || !profile?.canEdit; });
    get('hq-image-choice').disabled = busy || !writable || !profile;
    get('hq-share').disabled = busy || !writable || !profile?.screenshotChoices?.length;
    get('hq-screenshots').querySelectorAll('button').forEach(button => { button.disabled = busy || !writable; });
  }
  async function refresh(epoch,preserveDraft=true) {
    const next=await api('/api/group-headquarters');
    if(epoch!==generation)return;
    if(expectedGroup!==undefined&&next.groupId!==expectedGroup)throw new Error('Group membership changed. Refresh Headquarters.');
    const draft={description:get('hq-description').value,emblem:get('hq-emblem-choice').value};
    const keep=preserveDraft && dirty() && profile?.canEdit && next.canEdit && profile.groupId===next.groupId &&
      !(next.description===draft.description.trim()&&next.emblem===draft.emblem);
    profile=next;
    get('hq-name').textContent = profile.name;
    get('hq-current').textContent = profile.description || 'Your group has no description yet.';
    get('hq-description').value = keep?draft.description:profile.description;
    get('hq-emblem-choice').value = keep?draft.emblem:profile.emblem || 'leaf';
    if(!keep)draftRevision=profile.revision;
    get('hq-emblem').textContent = {leaf:'🌿 Leaf',claw:'🐾 Claw',mountain:'⛰ Mountain',sun:'☀ Sun'}[profile.emblem || 'leaf'];
    get('hq-editor').hidden = !profile.canEdit;
    const history = get('hq-history'); history.replaceChildren();
    for (const edit of profile.edits) {
      const item = document.createElement('li');
      item.textContent = `Revision ${edit.revision} · ${edit.createdAt} · ${edit.emblem || 'leaf'} · ${edit.description || '(description cleared)'}`;
      history.append(item);
    }
    const ranks = get('hq-ranks'); ranks.replaceChildren();
    for (const member of profile.members || []) {
      const row = document.createElement('div');
      const label = document.createElement('p'); label.textContent = `${member.name} · ${member.rank}`; row.append(label);
      if (profile.canEdit && member.role !== 'owner') {
        const select = document.createElement('select'); select.setAttribute('aria-label', `Rank for ${member.name}`);
        for (const rank of ['member','veteran','officer']) select.add(new Option(rank,rank));
        select.value = member.rank;
        const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Save rank';
        button.addEventListener('click', () => {
          if (writable && profile?.canEdit) action(() => api('/api/group-headquarters/ranks', { method:'POST', body:JSON.stringify({memberSteamId:member.steamId,rank:select.value,expectedRevision:member.rankRevision,expectedGroupId:profile.groupId}) }));
        });
        row.append(select,button);
      }
      ranks.append(row);
    }
    const rankHistory=get('hq-rank-history'); rankHistory.replaceChildren();
    for (const edit of profile.rankEdits || []) {
      const item=document.createElement('li'); item.textContent=`${edit.memberName} · ${edit.rank} · ${edit.createdAt}`; rankHistory.append(item);
    }
    const choices=get('hq-image-choice'); choices.replaceChildren();
    for(const image of profile.screenshotChoices||[])choices.add(new Option(image.title,image.id));
    const screenshots=get('hq-screenshots'); screenshots.replaceChildren();
    for(const image of profile.screenshots||[]){
      const card=document.createElement('figure'),caption=document.createElement('figcaption');
      caption.textContent=image.title+(image.author?` · ${image.author}`:'');card.append(caption);
      if(image.available){const picture=document.createElement('img');picture.src='/api/gallery/'+encodeURIComponent(image.id)+'/image';picture.alt=image.title;picture.loading='lazy';picture.style.maxWidth='100%';card.append(picture);}
      if(image.canRemove){const button=document.createElement('button');button.type='button';button.className='small-button';button.textContent='Remove screenshot';
        button.addEventListener('click',()=>{if(writable)action(()=>api('/api/group-headquarters/screenshots',{method:'POST',body:JSON.stringify({imageId:image.id,remove:true,expectedGroupId:profile.groupId})}));});card.append(button);}
      screenshots.append(card);
    }
    get('hq-status').textContent = writable ? (profile.canEdit ? 'You can edit your group description.' : 'The group owner can edit this description.') : 'This preview is read-only.';
    if(keep&&draftRevision!==profile.revision)get('hq-status').textContent='The saved description changed. Your draft is kept; discard it to load the latest version.';
    controls();
  }
  async function action(save = false,preserveDraft=true) {
    if (busy) return;
    const epoch=generation;
    busy = true; controls();
    try {
      if (typeof save === 'function') await save();
      else if (save) await api('/api/group-headquarters', { method: 'POST', body: JSON.stringify({ description: get('hq-description').value, emblem: get('hq-emblem-choice').value, expectedRevision: draftRevision,expectedGroupId:profile.groupId }) });
      if(epoch===generation)await refresh(epoch,preserveDraft);
    } catch (error) {
      if(epoch!==generation)return;
      // Recover ownership and revision after a response is lost or membership changes.
      try { await refresh(epoch,preserveDraft); }
      catch { if(epoch===generation)clear(); }
      if(epoch===generation)get('hq-status').textContent = error.message;
    } finally { if(epoch===generation){busy=false;controls();if(refreshPending){refreshPending=false;void action();}} }
  }
  get('hq-form').addEventListener('submit', event => { event.preventDefault(); if (writable && profile?.canEdit) action(true); });
  get('hq-refresh').addEventListener('click', () => action());
  get('hq-discard').addEventListener('click',()=>action(false,false));
  for(const id of ['hq-description','hq-emblem-choice'])get(id).addEventListener('input',controls);
  get('hq-share-form').addEventListener('submit',event=>{event.preventDefault();if(writable&&profile&&get('hq-image-choice').value)action(()=>api('/api/group-headquarters/screenshots',{method:'POST',body:JSON.stringify({imageId:get('hq-image-choice').value,expectedGroupId:profile.groupId})}));});
  window.addEventListener('hv:group-state', event => {
    const groupId=event.detail?.groupId??null;
    const changed=groupId!==(expectedGroup??profile?.groupId);
    expectedGroup=groupId;
    if (!active) return;
    get('group-headquarters').hidden=groupId===null;
    if(changed){generation++;busy=false;refreshPending=false;clear();get('hq-status').textContent='';}
    else if(busy){refreshPending=true;return;}
    if(groupId===null)return;
    action();
  });
  (async () => {
    try {
      const capability = await api('/api/group-headquarters/capabilities');
      if (!capability.enabled || !(await loadMe())?.user?.steam_id) return;
      active = true; writable = !capability.readOnly; get('group-headquarters').hidden = expectedGroup===null;
      if(expectedGroup!==null)await action();
    } catch (error) { get('hq-status').textContent = error.message; }
  })();
})();
