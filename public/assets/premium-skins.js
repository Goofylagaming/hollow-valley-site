(() => {
  const {api,escapeHtml:escapeText}=window.HDS;
  const esc=(value)=>escapeText(String(value??'')).replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  let catalog={enabled:false,skins:[]};
  let adminCatalog={skins:[]};
  let monthly=null;
  let readOnly=true;
  const el=(id)=>document.getElementById(id);
  const rarityAttempts=new Map();
  function rarityForm(skin){
    const choices=[['','Unclassified'],['common','Common'],['rare','Rare'],['epic','Epic'],['legendary','Legendary'],['event','Event']];
    return `<form data-premium-rarity="${esc(skin.id)}" class="premium-rarity-form"><fieldset ${readOnly?'disabled':''}><legend>Rarity classification</legend><label>Rarity<select name="rarity">${choices.map(([value,label])=>`<option value="${value}" ${value===(skin.rarity||'')?'selected':''}>${label}</option>`).join('')}</select></label><label>Reason<textarea name="reason" required minlength="10" maxlength="500"></textarea></label><button type="submit" class="small-button">Save classification</button></fieldset><details><summary>Recent classification history</summary>${(skin.rarityHistory||[]).map(r=>`<p>${esc(r.at)} · ${esc(r.actor)} · ${esc(r.rarity||'Unclassified')}: ${esc(r.reason)}</p>`).join('')||'<p>No classification recorded.</p>'}</details></form>`;
  }
  function safeHex(value){return /^#[a-f0-9]{6}$/i.test(String(value))?value:'#445548';}
  function card(skin,admin=false){
    const pending=(monthly?.claims||[]).find((claim)=>claim.skinId===skin.id && ['pending','reserved'].includes(claim.status));
    const canClaim=!readOnly && (pending || (catalog.enabled && monthly?.enabled && Number(monthly.remaining)>0));
    const actions=admin
      ? `${skin.state==='draft'?`<button class="small-button" data-premium-edit="${esc(skin.id)}" ${readOnly?'disabled':''}>Edit in Studio</button><button class="small-button" data-premium-verify="${esc(skin.id)}" ${readOnly?'disabled':''}>Record in-game check</button>`:''}${skin.state!=='draft'?`<button class="small-button" data-premium-publish="${esc(skin.id)}" data-published="${skin.published?'0':'1'}" ${readOnly?'disabled':''}>${skin.published?'Remove from collection':'Publish to collection'}</button>`:''}`
      : skin.owned?'<a class="small-button" href="#my-skins" data-premium-mine>In My Skins</a>':`<button class="small-button" data-premium-claim="${esc(skin.id)}" ${canClaim?'':'disabled'}>${pending?'Retry pending claim':'Choose this skin'}</button>`;
    return `<article class="premium-card"><div class="premium-palette" aria-label="${esc(skin.name)} colour palette">${(skin.swatches||[]).map((swatch)=>`<span style="background:${safeHex(swatch.color)}" title="${esc(swatch.zone)}"></span>`).join('')}<b>PREMIUM</b></div><div class="premium-card-body"><span class="premium-collection-label">${esc(skin.collectionKey.replaceAll('-',' '))}</span><h3>${esc(skin.name)}</h3><p>${esc(skin.description)}</p><p>Rarity: ${esc(skin.rarity||'Unclassified')}</p><p class="premium-compatibility">${skin.verifiedSpecies?.length?`Verified in-game: ${esc(skin.verifiedSpecies.join(', '))}`:'Draft palette · in-game review pending'}</p>${admin?`<span class="premium-review-state">${esc(skin.state)}</span>`:''}<div class="premium-card-actions">${actions}</div>${admin?rarityForm(skin):''}</div></article>`;
  }
  function render(){
    el('premium-skin-grid').innerHTML=catalog.skins.length?catalog.skins.map((skin)=>card(skin)).join(''):'<div class="premium-empty"><strong>The first collection is being prepared.</strong>Premium skins will appear here after their in-game review. Your existing skins remain in My Skins.</div>';
    let status='Sign in with Steam to see your monthly skin choices.';
    if(me.loggedIn){
      if(readOnly)status='This preview lets you browse the collection. Skin claims and collection changes are disabled here.';
      else if(!catalog.enabled || !monthly?.enabled)status='Monthly skin choices are being prepared. Check My Membership for your current benefits.';
      else if(!monthly.periodEnd)status='A verified paid membership period is needed before choosing a monthly skin.';
      else status=`${Number(monthly.remaining)||0} of ${Number(monthly.allowance)||0} skin choices available this paid period. Claimed skins stay yours.`;
      if(monthly?.claimError)status+=' A previous claim needs another attempt; retry it below.';
    }
    const missingPending=(monthly?.claims||[]).filter((claim)=>['pending','reserved'].includes(claim.status) && !catalog.skins.some((skin)=>skin.id===claim.skinId));
    el('premium-membership-status').innerHTML=`${esc(status)} <a href="/supporter#membership-rewards">My Membership →</a>${missingPending.map((claim)=>`<div class="premium-card-actions"><button class="small-button" data-premium-claim="${esc(claim.skinId)}" ${readOnly?'disabled':''}>Retry pending skin claim</button></div>`).join('')}`;
    el('premium-admin').hidden=!Boolean(me.user?.is_admin);
    if(me.user?.is_admin){
      el('premium-admin-grid').innerHTML=adminCatalog.skins.length?adminCatalog.skins.map((skin)=>card(skin,true)).join(''):'<div class="premium-empty"><strong>No premium drafts yet.</strong>Prepare the starter palettes or clone one of your saved Studio designs.</div>';
      el('premium-source-preset').innerHTML='<option value="">Select a design</option>'+(mineState?.presets||[]).filter((skin)=>skin.owner_steam_id===me.user?.steam_id && !skin.membershipPremium).map((skin)=>`<option value="${esc(skin.id)}">${esc(skin.name)}</option>`).join('');
      el('premium-seed-drafts').disabled=readOnly;
      el('premium-create-draft').disabled=readOnly;
    }
  }
  async function refresh(){
    const requests=[api('/api/skins/premium'),api('/api/skins/studio-context')];
    if(me.loggedIn)requests.push(api('/api/supporter/rewards'));
    if(me.user?.is_admin)requests.push(api('/api/skins/premium/admin'));
    const results=await Promise.allSettled(requests);
    if(results[0].status!=='fulfilled'){
      el('premium-skin-grid').innerHTML='<div class="premium-empty"><strong>Collection temporarily unavailable.</strong>Please refresh to try again.</div>';
      el('premium-membership-status').textContent='Premium skin choices could not be loaded.';return;
    }
    catalog=results[0].value;
    readOnly=results[1].status!=='fulfilled'||Boolean(results[1].value.readOnly);
    monthly=me.loggedIn && results[2]?.status==='fulfilled'?results[2].value.monthly:null;
    const adminResult=results[me.loggedIn?3:2];
    adminCatalog=me.user?.is_admin && adminResult?.status==='fulfilled'?adminResult.value:{skins:[]};
    render();
  }
  async function action(button,callback){button.disabled=true;try{await callback();await loadMine();await refresh();}catch(error){showAlert(error.message,'error');button.disabled=false;}}
  el('premium-refresh').addEventListener('click',()=>refresh().catch((error)=>showAlert(error.message,'error')));
  el('premium-admin-grid').addEventListener('submit',async event=>{
    const form=event.target.closest('[data-premium-rarity]');if(!form)return;event.preventDefault();if(readOnly)return;
    const skin=adminCatalog.skins.find(s=>s.id===form.dataset.premiumRarity);if(!skin)return;
    const body={rarity:form.elements.rarity.value||null,reason:form.elements.reason.value.trim(),expectedRevision:skin.rarityRevision||0};
    if(body.reason.length<10)return;
    const signature=JSON.stringify(body),old=rarityAttempts.get(skin.id);
    const attempt=old?.signature===signature?old:{signature,requestId:crypto.randomUUID()};rarityAttempts.set(skin.id,attempt);
    const fields=form.querySelector('fieldset');fields.disabled=true;
    try{await api(`/api/skins/premium/admin/${encodeURIComponent(skin.id)}/rarity`,{method:'POST',body:JSON.stringify({...body,requestId:attempt.requestId})});rarityAttempts.delete(skin.id);showAlert('Classification saved.','success');await refresh();}
    catch(error){showAlert(error.message,'error');fields.disabled=false;}
  });
  el('premium-seed-drafts').addEventListener('click',(event)=>action(event.currentTarget,async()=>{
    await api('/api/skins/premium/admin/seed-drafts',{method:'POST',body:'{}'});showAlert('Prepared Ashfall, Moonlit Marsh and Valley Royalty as private drafts.','success');
  }));
  el('premium-create-draft').addEventListener('click',(event)=>action(event.currentTarget,async()=>{
    const presetId=el('premium-source-preset').value;if(!presetId)throw new Error('Choose one of your saved designs first.');
    await api('/api/skins/premium/admin/drafts',{method:'POST',body:JSON.stringify({presetId,collection:el('premium-collection-key').value})});showAlert('Created a separate premium draft. Your original design is unchanged.','success');
  }));
  el('premium-collection').addEventListener('click',async(event)=>{
    const button=event.target.closest('button,a');if(!button)return;
    if(button.hasAttribute('data-premium-mine')){event.preventDefault();activateSkinTab('mine');return;}
    if(button.dataset.premiumClaim)return action(button,async()=>{
      await api(`/api/supporter/rewards/skins/${encodeURIComponent(button.dataset.premiumClaim)}/claim`,{method:'POST',body:'{}'});
      showAlert('Your premium skin is now in My Skins.','success');
    });
    if(button.dataset.premiumEdit){
      const skin=adminCatalog.skins.find((item)=>item.id===button.dataset.premiumEdit);if(!skin)return;
      editingPresetId=null;editingPremiumSkinId=skin.id;
      el('skin-species').value=skin.species;el('skin-name').value=skin.name;el('skin-description').value=skin.description;
      applySkinToEditor(skin.skin);updatePreview();el('skin-save').textContent='Save premium draft →';activateSkinTab('studio');
      showAlert('Editing a private premium draft. Save it here, then use My Skins to test it in-game before recording your check.','info');return;
    }
    if(button.dataset.premiumVerify){
      const currentSkin=adminCatalog.skins.find((item)=>item.id===button.dataset.premiumVerify);if(!currentSkin)return;
      const species=prompt('Which dinosaur species did you test this exact saved draft on in-game? Separate names with commas.','');if(!species)return;
      const note=prompt('Record what you checked, including the species, skin appearance and any limitations.','');if(!note)return;
      if(!confirm('Confirm that you applied this exact draft in-game and checked its appearance on every listed species. This records verification; publication is a separate step.'))return;
      return action(button,()=>api(`/api/skins/premium/admin/${encodeURIComponent(button.dataset.premiumVerify)}/verify`,{method:'POST',body:JSON.stringify({verifiedSpecies:species.split(',').map((x)=>x.trim()).filter(Boolean),note,confirmedInGame:true,expectedVersion:currentSkin.version})}));
    }
    if(button.dataset.premiumPublish){
      const published=button.dataset.published==='1';
      if(!confirm(published?'Publish this reviewed skin to the membership collection?':'Remove this skin from new membership choices? Existing owners keep their skin.'))return;
      return action(button,()=>api(`/api/skins/premium/admin/${encodeURIComponent(button.dataset.premiumPublish)}/publish`,{method:'POST',body:JSON.stringify({published})}));
    }
  });
  function useHash(){if(location.hash==='#premium-collection')activateSkinTab('premium');}
  window.addEventListener('hashchange',useHash);
  document.addEventListener('hds:skin-admin-ready',()=>{useHash();refresh().catch((error)=>showAlert(error.message,'error'));});
  document.addEventListener('hds:skin-collection-ready',()=>{refresh().catch((error)=>showAlert(error.message,'error'));});
  window.HVPremiumSkins={refresh};
})();
