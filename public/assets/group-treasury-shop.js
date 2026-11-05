(() => {
  const {api,loadMe}=window.HDS,get=id=>document.getElementById(id),base='/api/group-treasury';
  const frames={none:'Standard',fern:'Fern',sandstone:'Sandstone',night:'Night'},money=value=>`${Number(value).toLocaleString()} Valley Coins`;
  const pending=row=>['draft','submitted','reserved'].includes(row.state);
  let model=null,assets=null,registrations=null,caps={},ready=false,active=false,busy=null,generation=0,expectedGroup;
  const manage=()=>ready&&model?.canManage&&!caps.readOnly;
  function controls(){
    get('treasury-shop-refresh').disabled=Boolean(busy);
    get('treasury-shop-item').disabled=Boolean(busy)||!manage();
    get('treasury-shop-review').disabled=Boolean(busy)||!manage()||!caps.spendingEnabled||!assets?.catalog?.length||model?.group?.closing||model?.purchases?.some(pending);
    get('treasury-frame-choice').disabled=Boolean(busy)||!manage()||model?.group?.closing;
    const frame=get('treasury-frame-choice').value;
    get('treasury-frame-save').disabled=Boolean(busy)||!manage()||model?.group?.closing||frame===model?.selection?.frame||(frame!=='none'&&!assets?.cosmetics?.some(value=>value.frame===frame));
    get('treasury-purchase-pending').querySelectorAll('[data-action]').forEach(button=>{
      const interrupt=(button.dataset.action==='release'&&['confirm','refresh'].includes(busy))||(button.dataset.action==='check'&&busy==='refresh');
      button.disabled=(!interrupt&&Boolean(busy))||!manage();
      if(button.dataset.action==='confirm')button.disabled ||= !get('treasury-purchase-consent')?.checked;
    });
    const consent=get('treasury-purchase-consent');if(consent)consent.disabled=Boolean(busy)||!manage();
  }
  function render(){
    const group=model?.group,purchases=model?.purchases||[],open=purchases.find(pending),selection=model?.selection||{frame:'none',revision:0};
    get('treasury-shop-form').hidden=!model?.canManage||!caps.spendingEnabled||!assets?.catalog?.length||Boolean(open)||group?.closing;
    const choices=get('treasury-shop-item');choices.replaceChildren();
    for(const value of assets?.catalog||[])choices.add(new Option(`${value.title} · ${money(value.cost)}`,`${value.id}:${value.revision}`));
    get('treasury-frame-current').textContent=`Selected frame: ${frames[selection.frame]||'Standard'}`;
    const frameChoices=get('treasury-frame-choice');frameChoices.replaceChildren();frameChoices.add(new Option('Standard (no frame)','none'));
    for(const value of assets?.cosmetics||[])frameChoices.add(new Option(frames[value.frame],value.frame));
    if(selection.frame!=='none'&&!assets?.cosmetics?.some(value=>value.frame===selection.frame))frameChoices.add(new Option(`${frames[selection.frame]} (verification unavailable)`,selection.frame));
    frameChoices.value=selection.frame;get('treasury-frame-form').hidden=!model?.canManage;
    const history=get('treasury-purchase-history');history.replaceChildren();
    for(const value of purchases){const li=document.createElement('li');li.textContent=`${value.item.title} · ${money(value.item.cost)} · ${{draft:'Awaiting confirmation',submitted:'Outcome pending',reserved:'Reservation recorded; check outcome',committed:'Purchased',released:'Released'}[value.state]||'Unknown'}`;history.append(li);}
    if(!purchases.length){const li=document.createElement('li');li.textContent='No group purchases yet.';history.append(li);}
    const registrationList=get('treasury-event-registrations');registrationList.replaceChildren();
    get('treasury-event-registration-status').textContent=registrations===null?'Registrations have not been verified.':registrations.length?'Registration covers the group; individual attendance and rewards are separate.':'No recorded group event registrations.';
    for(const row of registrations||[]){const li=document.createElement('li');li.textContent=`${row.event.eventName} · ${new Date(row.event.startTime).toLocaleString()} · Registered`;registrationList.append(li);}
    const container=get('treasury-purchase-pending');container.replaceChildren();
    if(open){
      const title=document.createElement('h4');title.textContent=`Review ${open.item.title} for ${money(open.item.cost)} from ${group.name}`;container.append(title);
      if(open.fulfillment){const target=document.createElement('p');target.textContent=open.item.purpose==='event_registration'?`Event: ${open.fulfillment.eventName} · ${new Date(open.fulfillment.startTime).toLocaleString()} – ${open.fulfillment.endTime?new Date(open.fulfillment.endTime).toLocaleString():'end time not set'}. Registration covers this group; it does not confirm members' attendance or rewards.`:`Territory group: ${open.fulfillment.territoryGroupName} · Event: ${open.fulfillment.eventName} (#${open.fulfillment.eventId}). This saved purchase uses the reviewed group link.`;container.append(target);
        if(open.item.purpose==='event_registration'){const link=document.createElement('a');link.href=`https://discord.com/events/${open.fulfillment.guildId}/${open.fulfillment.eventId}`;link.textContent='View this Discord event';link.target='_blank';link.rel='noopener noreferrer';container.append(link);}}
      const note=document.createElement('p');note.textContent=open.state==='draft'?'No coins are reserved by this draft.':'The final outcome needs checking. Check status or release the uncommitted request.';container.append(note);
      const cancellation=document.createElement('p');cancellation.textContent=open.item.purpose==='territory_entry'?'Cancellation keeps coins reserved until non-delivery is verified. A registered entry stays paid.':'Releasing an uncommitted request frees its reservation. A completed purchase stays paid.';container.append(cancellation);
      if(model.canManage){
        const canConfirm=caps.spendingEnabled&&(open.item.purpose!=='territory_entry'||caps.territoryEntryEnabled)&&(open.item.purpose!=='event_registration'||caps.eventRegistrationEnabled)&&!group.closing&&Boolean(assets)&&!['SPEND_RESPONSE_MISMATCH','TREASURY_INTEGRITY_ERROR','ITEM_UNAVAILABLE','PRICE_CHANGED','GROUP_CLOSING','ENTRY_LINK_CHANGED','ENTRY_EVENT_UNAVAILABLE','ENTRY_LEADER_REQUIRED','ENTRY_LINK_REQUIRED','ENTRY_TEST_RESTRICTED','ENTRY_EVIDENCE_INCOMPLETE','GROUP_EVENT_CHANGED','GROUP_EVENT_NOT_OPEN','GROUP_EVENT_UNAVAILABLE'].includes(open.lastErrorCode);
        if(canConfirm){const label=document.createElement('label'),checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.id='treasury-purchase-consent';
          label.append(checkbox,document.createTextNode(` I confirm spending ${money(open.item.cost)} from ${group.name} on ${open.item.title}.`));container.append(label);checkbox.addEventListener('change',controls);}
        function button(kind,label){const element=document.createElement('button');element.type='button';element.className='small-button';element.textContent=label;element.dataset.action=kind;
          element.addEventListener('click',()=>{
            if(!manage()||(kind==='confirm'&&!get('treasury-purchase-consent')?.checked))return;
            act(kind,()=>api(`${base}/purchases/${encodeURIComponent(open.requestId)}/${kind==='check'?'reconcile':kind}`,{method:'POST',body:JSON.stringify({expectedGroupId:group.id,...(kind==='confirm'?{confirmed:true}:{})})}));
          });container.append(element);}
        if(canConfirm)button('confirm',open.state==='draft'?'Confirm purchase':'Finish same purchase');
        if(open.state!=='draft')button('check','Check purchase status');
        button('release',open.state==='draft'?'Cancel purchase':'Release uncommitted funds');
      }else{const text=document.createElement('p');text.textContent='The current group owner can manage this purchase.';container.append(text);}
      if(open.lastErrorCode){const error=document.createElement('p');error.textContent={GROUP_EVENT_CHANGED:'The event schedule or details changed. Release this request and review a new one.',GROUP_EVENT_NOT_OPEN:'This event is no longer open for group registration. Release the uncommitted request.',GROUP_EVENT_FEED_UNAVAILABLE:'A fresh event update is unavailable. Check again or release the request.',GROUP_EVENT_DISABLED:'New event registrations are unavailable. Existing requests can still be checked or released.',INSUFFICIENT_TREASURY:'Not enough available group coins.',ITEM_UNAVAILABLE:'This reviewed item is no longer available. Release the request before choosing another.',TREASURY_SPENDING_DISABLED:'New spending is unavailable. You can check status or release an uncommitted request.',SPEND_RESPONSE_MISMATCH:'The receipt could not be verified. Check status or contact support.',TREASURY_INTEGRITY_ERROR:'This purchase needs staff review.'}[open.lastErrorCode]||'The service could not confirm the outcome. Check status or release the uncommitted request.';container.append(error);}
    }
    controls();
  }
  function forget(){model=null;assets=null;registrations=null;ready=false;render();get('treasury-shop').hidden=true;}
  async function load(epoch){
    ready=false;controls();const [capability,state]=await Promise.all([api(`${base}/capabilities`),api(`${base}/purchases`)]);
    if(epoch!==generation)return;caps=capability;
    if(!state.group||(expectedGroup!==undefined&&state.group.id!==expectedGroup)){forget();return;}
    model=state;assets=null;registrations=null;ready=true;render();
    get('treasury-shop').hidden=!caps.spendingEnabled&&!model.purchases.length&&model.selection.frame==='none';
    get('treasury-shop-status').textContent=caps.readOnly?'This preview is read-only.':caps.spendingEnabled?'':'New purchases are unavailable. Existing group purchases and frames remain accessible.';
    if(get('treasury-shop').hidden)return;
    const registrationRead=api(`${base}/event-registrations`).then(result=>{
      if(epoch!==generation)return;
      if(result.groupId!==model.group.id)throw new Error('Group membership changed. Refresh registrations.');
      registrations=result.registrations;render();
    }).catch(error=>{if(epoch!==generation)return;if([401,403,404].includes(error.status))forget();else{registrations=null;render();get('treasury-event-registration-status').textContent='Registrations are unavailable. Refresh to verify them.';}});
    try{
      const result=await api(`${base}/spending`);if(epoch!==generation)return;
      if(result.groupId!==model.group.id)throw new Error('Group membership changed. Refresh purchases.');assets=result;render();
      if(!assets.catalog.length&&caps.spendingEnabled)get('treasury-shop-status').textContent='No reviewed group purchases are available.';
    }catch(error){if(epoch===generation){if([401,403,404].includes(error.status)){forget();throw error;}
      assets=null;render();get('treasury-shop-status').textContent='The purchase catalog is unavailable. Saved requests can still be checked or released.';}}
    await registrationRead;
  }
  async function act(kind,mutation){
    if(busy&&!((kind==='release'&&['confirm','refresh'].includes(busy))||(kind==='check'&&busy==='refresh')))return;
    const epoch=++generation;busy=kind;controls();
    try{if(mutation)await mutation();if(epoch===generation)await load(epoch);}
    catch(error){if(epoch!==generation)return;try{await load(epoch);}catch(recoveryError){if(epoch===generation){ready=false;if([error.status,recoveryError.status].some(value=>[401,403,404].includes(value)))forget();}}
      if(epoch===generation)get('treasury-shop-status').textContent=error.message||'Purchases could not refresh.';}
    finally{if(epoch===generation){busy=null;controls();if(mutation&&model?.group)window.dispatchEvent(new CustomEvent('hv:treasury-changed',{detail:{groupId:model.group.id}}));}}
  }
  get('treasury-shop-refresh').addEventListener('click',()=>act('refresh'));
  get('treasury-frame-choice').addEventListener('change',controls);
  get('treasury-shop-form').addEventListener('submit',event=>{
    event.preventDefault();if(!manage()||!caps.spendingEnabled||model.group.closing||model.purchases.some(pending))return;
    const selected=assets?.catalog.find(value=>`${value.id}:${value.revision}`===get('treasury-shop-item').value);if(!selected)return;
    const body={expectedGroupId:model.group.id,itemId:selected.id,revision:selected.revision,expectedCost:selected.cost,requestId:crypto.randomUUID()};
    act('prepare',()=>api(`${base}/purchases`,{method:'POST',body:JSON.stringify(body)}));
  });
  get('treasury-frame-form').addEventListener('submit',event=>{
    event.preventDefault();if(!manage()||model.group.closing)return;
    const body={expectedGroupId:model.group.id,frame:get('treasury-frame-choice').value,expectedRevision:model.selection.revision};
    act('frame',async()=>{
      const result=await api(`${base}/cosmetic-frame`,{method:'POST',body:JSON.stringify(body)});
      if(result.groupId===body.expectedGroupId&&result.frame===body.frame)window.dispatchEvent(new CustomEvent('hv:group-cosmetic',{detail:{groupId:result.groupId,frame:result.frame}}));
    });
  });
  window.addEventListener('hv:group-state',event=>{expectedGroup=event.detail?.groupId??null;if(!active)return;generation++;busy=null;forget();void act('refresh');});
  (async()=>{if(!/^\d{17}$/.test(String((await loadMe())?.user?.steam_id||'')))return;active=true;await act('refresh');})();
})();
