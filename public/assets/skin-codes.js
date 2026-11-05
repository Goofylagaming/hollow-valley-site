(() => {
  const {api,loadMe}=window.HDS,$=id=>document.getElementById(id);
  const status=$('promo-status'),issue=$('promo-issue'),redeem=$('promo-redeem');
  let user=null,writable=false,attempt=null,confirmed=false,issueBusy=false;
  const node=(tag,text)=>{const el=document.createElement(tag);el.textContent=text;return el;};
  const post=(path,body)=>api('/api/skins/promos'+path,{method:'POST',body:JSON.stringify(body)});
  async function history(){
    const data=await api('/api/skins/promos/admin');$('promo-history').replaceChildren();
    for(const row of data.codes){
      const card=node('article','');card.append(node('h3',row.name||'Skin no longer available'),node('p',row.reason));
      const state=row.redeemedAt!==null?'Redeemed':row.revokedAt!==null?'Revoked':row.expiresAt<=Date.now()?'Expired':'Available';
      card.append(node('p',`${state} · Expires ${new Date(row.expiresAt).toLocaleString()}`));
      if(state==='Available'){
        const form=node('form',''),label=node('label','Revocation reason'),reason=node('textarea',''),button=node('button','Revoke code');
        reason.required=true;reason.minLength=10;reason.maxLength=500;label.append(reason);button.type='submit';button.disabled=!writable;form.append(label,button);card.append(form);
        form.addEventListener('submit',async event=>{event.preventDefault();if(!writable)return;button.disabled=true;
          try{await post('/admin/revoke',{id:row.id,reason:reason.value.trim()});status.textContent='Code revoked.';await history();}
          catch(e){status.textContent=e.message;button.disabled=false;}
        });
      }
      $('promo-history').append(card);
    }
    if(!data.codes.length)$('promo-history').append(node('p','No codes issued yet.'));
  }
  issue.addEventListener('submit',async event=>{
    event.preventDefault();if(!writable||issueBusy||confirmed)return;
    if(!attempt){
      const code='HVP-'+Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
      attempt={code,presetId:issue.elements.presetId.value,reason:issue.elements.reason.value.trim(),expiresAt:Date.now()+Number(issue.elements.days.value)*86400000,requestId:crypto.randomUUID()};
      $('promo-code').value=code;$('promo-secret').hidden=false;
    }
    issueBusy=true;issue.querySelector('fieldset').disabled=true;issue.querySelector('button').disabled=true;
    $('promo-secret-status').textContent='Issuance not yet confirmed. Keep this page open and retry if needed; do not share this code yet.';
    try{
      await post('/admin/issue',attempt);confirmed=true;$('promo-new').hidden=false;
      $('promo-secret-status').textContent='Code issued. Save and share it privately.';status.textContent='Promotional code created.';
      try{await history();}catch{status.textContent+=' History is unavailable; your code above is saved.';}
    }catch(e){status.textContent=e.message;issue.querySelector('button').textContent='Retry this code';issue.querySelector('button').disabled=false;}
    finally{issueBusy=false;}
  });
  $('promo-new').addEventListener('click',()=>{
    if(!confirmed)return;attempt=null;confirmed=false;$('promo-code').value='';$('promo-secret').hidden=true;$('promo-new').hidden=true;
    issue.reset();issue.querySelector('fieldset').disabled=!writable;issue.querySelector('button').disabled=!writable;issue.querySelector('button').textContent='Create code';
  });
  redeem.addEventListener('submit',async event=>{
    event.preventDefault();if(!writable)return;const button=redeem.querySelector('button');button.disabled=true;
    try{const data=await post('/redeem',{code:redeem.elements.code.value.trim()});status.textContent=data.stillOwned===false?'This code was previously redeemed by your account, but you no longer own that skin.':data.alreadyOwned?'You already own this skin. The code has not been used.':'Skin unlocked. Open My Skins in Skin Studio to find it.';redeem.reset();}
    catch(e){status.textContent=e.message;}finally{button.disabled=false;}
  });
  $('promo-refresh').addEventListener('click',()=>history().catch(e=>{status.textContent=e.message;}));
  window.addEventListener('beforeunload',event=>{if(attempt){event.preventDefault();event.returnValue='';}});
  (async()=>{
    try{
      const capabilities=await api('/api/skins/promos/capabilities');
      if(!capabilities.enabled){status.textContent='Promotional skin codes are not open yet.';return;}
      user=(await loadMe())?.user;if(!user?.steam_id){$('promo-signin').hidden=false;status.textContent='Sign in to continue.';return;}
      writable=capabilities.readOnly===false;redeem.hidden=false;redeem.querySelector('button').disabled=!writable;
      status.textContent=writable?'Enter your code below.':'This preview is read-only. Code changes and redemption are disabled.';
      if(user.is_admin){
        $('promo-admin').hidden=false;await history();
        const data=await api('/api/skins/mine');
        for(const skin of data.presets||[])if(skin.active&&skin.owner_steam_id===user.steam_id&&!skin.membershipPremium)issue.elements.presetId.add(new Option(skin.name,skin.id));
        issue.querySelector('fieldset').disabled=!writable;issue.querySelector('button').disabled=!writable||issue.elements.presetId.options.length<2;
      }
    }catch(e){status.textContent=e.message;}
  })();
})();
