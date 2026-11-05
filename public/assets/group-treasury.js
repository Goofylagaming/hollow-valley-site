(() => {
  const {api,loadMe}=window.HDS,get=id=>document.getElementById(id),base='/api/group-treasury';
  let model=null,capability={enabled:false,readOnly:true},ready=false,active=false,busy=null,generation=0,expectedGroup,refreshPending=false;
  const money=value=>`${Number(value).toLocaleString()} Valley Coins`;
  const unresolved=row=>['draft','submitted'].includes(row.state);
  const writable=()=>ready&&!capability.readOnly;
  function controls(){
    get('treasury-refresh').disabled=Boolean(busy);
    get('treasury-amount').disabled=Boolean(busy)||!writable();
    get('treasury-review').disabled=Boolean(busy)||!writable()||!capability.enabled||!model?.treasury||model?.group?.closing||model.donations.some(unresolved);
    get('treasury-pending').querySelectorAll('[data-action]').forEach(button=>{
      const interrupt=(button.dataset.action==='cancel'&&['confirm','refresh'].includes(busy))||(button.dataset.action==='check'&&busy==='refresh');
      button.disabled=(!interrupt&&Boolean(busy))||!writable()||button.dataset.allowed!=='true';
      if(button.dataset.action==='confirm')button.disabled ||= !get('treasury-consent')?.checked;
    });
    const consent=get('treasury-consent');if(consent)consent.disabled=Boolean(busy)||!writable();
  }
  function render(){
    const group=model?.group,donations=model?.donations||[],pending=donations.find(unresolved);
    get('treasury-group').textContent=group?`Current group: ${group.name}`:'Join a group to view its Treasury.';
    get('treasury-balance').textContent=model?.treasury?money(model.treasury.balance):'Unavailable';
    get('treasury-reserved').hidden=!(model?.treasury?.held>0);
    get('treasury-reserved').textContent=model?.treasury?`Available to spend: ${money(model.treasury.available)} · Reserved: ${money(model.treasury.held)}`:'';
    get('treasury-availability').textContent=group?.closing?'A Treasury closure check is pending. Finish or cancel it in Groups.':capability.readOnly?'This preview is read-only.':capability.enabled?'':'New donations are unavailable. You can still review or cancel earlier requests.';
    get('treasury-form').hidden=!group||group.closing||!model?.treasury||!capability.enabled||Boolean(pending);
    const history=get('treasury-history');history.replaceChildren();
    for(const row of donations){
      const item=document.createElement('li');item.textContent=`${money(row.amount)} to ${row.groupName} · ${{draft:'Awaiting confirmation',submitted:'Outcome pending',confirmed:'Donated',cancelled:'Cancelled'}[row.state]||'Unknown'} · ${new Date(row.createdAt).toLocaleString()}`;history.append(item);
    }
    if(!donations.length){const item=document.createElement('li');item.textContent='No donation requests yet.';history.append(item);}
    const transactions=get('treasury-transactions');transactions.replaceChildren();
    for(const row of model?.treasury?.transactions||[]){const item=document.createElement('li');item.textContent=`${row.amount>0?'+':''}${money(row.amount)} · ${row.kind==='donation'?'Member donation':row.kind} · ${row.createdAt}`;transactions.append(item);}
    const container=get('treasury-pending');container.replaceChildren();
    if(pending){
      const heading=document.createElement('h3');heading.textContent=`Review ${money(pending.amount)} to ${pending.groupName}`;container.append(heading);
      const note=document.createElement('p');note.textContent=pending.state==='draft'?'No coins have been moved by this request.':
        'The outcome is pending. Coins may have moved. Check status before retrying the same donation.';container.append(note);
      const cancellation=document.createElement('p');cancellation.textContent='Cancellation stops an uncommitted donation. A completed donation is not refunded.';container.append(cancellation);
      const canConfirm=capability.enabled&&group?.id===pending.groupId&&!group.closing&&!['TREASURY_INTEGRITY_ERROR','TREASURY_RESPONSE_MISMATCH'].includes(pending.lastErrorCode);
      if(canConfirm){
        const label=document.createElement('label'),checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.id='treasury-consent';
        label.append(checkbox,document.createTextNode(` I confirm donating ${money(pending.amount)} to ${pending.groupName}.`));container.append(label);
        checkbox.addEventListener('change',controls);
      }
      function button(action,label,allowed){
        const element=document.createElement('button');element.type='button';element.className='small-button';element.textContent=label;
        element.dataset.action=action;element.dataset.allowed=String(allowed);
        element.addEventListener('click',()=>{
          if(!writable())return;
          if(action==='confirm'&&!get('treasury-consent')?.checked)return;
          const endpoint=action==='confirm'?'confirm':action==='cancel'?'cancel':'reconcile';
          act(action,()=>api(`${base}/donations/${encodeURIComponent(pending.id)}/${endpoint}`,{method:'POST',body:JSON.stringify(action==='confirm'?{confirmed:true,expectedGroupId:pending.groupId}:{})}));
        });container.append(element);
      }
      if(canConfirm)button('confirm',pending.state==='draft'?'Confirm donation':'Retry same donation',true);
      if(pending.state==='submitted')button('check','Check status',true);
      button('cancel',pending.state==='draft'?'Cancel request':'Cancel uncommitted donation',true);
      if(pending.lastErrorCode){
        const error=document.createElement('p');error.textContent={INSUFFICIENT_FUNDS:'Not enough Valley Coins. Check status or cancel this request.',GROUP_MEMBERSHIP_CHANGED:'Your group membership changed. Check status or cancel the uncommitted request.',GROUP_TREASURY_DISABLED:'New donations are unavailable. Check status or cancel the uncommitted request.',TREASURY_RESPONSE_MISMATCH:'The receipt could not be verified. Check status or contact support.',TREASURY_INTEGRITY_ERROR:'The donation needs staff review.'}[pending.lastErrorCode]||'The service could not confirm the outcome. Check status or cancel the uncommitted request.';container.append(error);
      }
    }
    controls();
  }
  async function load(epoch){
    ready=false;controls();
    const [caps,overview]=await Promise.all([api(`${base}/capabilities`),api(`${base}/donations`)]);
    if(epoch!==generation)return;
    capability=caps;model={...overview,treasury:null};
    const mismatch=expectedGroup!==undefined&&(overview.group?.id??null)!==expectedGroup;
    if(mismatch)model.group=null;
    get('group-treasury').hidden=!caps.enabled&&!overview.donations.length&&!overview.hasGroupActivity;
    ready=true;render();
    if(mismatch){get('treasury-status').textContent='Group membership changed. Refresh Treasury.';return;}
    get('treasury-status').textContent='';
    if(!get('group-treasury').hidden&&model.group){
      try{
        const state=await api(base);
        if(epoch!==generation)return;
        if(state.group?.id!==model.group.id)throw new Error('Group membership changed. Refresh Treasury.');
        model.treasury=state.treasury;render();
      }catch(error){if(epoch===generation){
        if([401,403].includes(error.status)){model=null;ready=false;render();get('group-treasury').hidden=true;throw error;}
        model.treasury=null;render();get('treasury-status').textContent='The group balance is unavailable. Your saved requests are still shown.';
      }}
    }
  }
  async function act(kind,mutation){
    if(busy&&!((kind==='cancel'&&['confirm','refresh'].includes(busy))||(kind==='check'&&busy==='refresh')))return;
    // A cancellation may overtake an in-flight confirmation. Its response is
    // authoritative; the older response must not repopulate the view afterward.
    const epoch=++generation;busy=kind;controls();
    try{
      if(mutation)await mutation();
      if(epoch===generation)await load(epoch);
    }catch(error){
      if(epoch!==generation)return;
      try{await load(epoch);}catch(recoveryError){
        if(epoch===generation){ready=false;if([error.status,recoveryError.status].some(status=>[401,403].includes(status))){model=null;render();get('group-treasury').hidden=true;}controls();}
      }
      if(epoch===generation)get('treasury-status').textContent=error.message||'Treasury could not refresh. Try again.';
    }finally{if(epoch===generation){busy=null;controls();if(refreshPending){refreshPending=false;void act('refresh');}}}
  }
  get('treasury-refresh').addEventListener('click',()=>act('refresh'));
  get('treasury-form').addEventListener('submit',event=>{
    event.preventDefault();if(!writable()||!capability.enabled||!model?.group||model.group.closing||!model.treasury||model.donations.some(unresolved))return;
    const value=get('treasury-amount').value.trim(),amount=Number(value);
    if(!/^\d+$/.test(value)||!Number.isSafeInteger(amount)||amount<1){get('treasury-status').textContent='Enter a positive whole number of Valley Coins.';return;}
    const body={amount,expectedGroupId:model.group.id,requestId:crypto.randomUUID()};
    act('prepare',()=>api(`${base}/donations`,{method:'POST',body:JSON.stringify(body)}));
  });
  window.addEventListener('hv:group-state',event=>{
    expectedGroup=event.detail?.groupId??null;if(!active)return;
    generation++;busy=null;refreshPending=false;ready=false;if(model){model.group=null;model.treasury=null;render();}
    void act('refresh');
  });
  window.addEventListener('hv:treasury-changed',event=>{if(!active||model?.group?.id!==event.detail?.groupId)return;if(busy)refreshPending=true;else void act('refresh');});
  (async()=>{
    if(!/^\d{17}$/.test(String((await loadMe())?.user?.steam_id||'')))return;
    active=true;await act('refresh');
  })();
})();
