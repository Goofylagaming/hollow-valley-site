(() => {
  const {api,loadMe}=window.HDS,$=id=>document.getElementById(id);
  const form=$('gift-offer'),status=$('gift-status'),list=$('gift-list');
  let user=null,writable=false,attempt=null,busy=false,sequence=0,recoveryCursor=0;
  const node=(tag,text)=>{const el=document.createElement(tag);el.textContent=text;return el;};
  const post=(path,body)=>api('/api/skins/gifts'+path,{method:'POST',body:JSON.stringify(body)});
  function controls(){$('gift-reconcile').disabled=!writable;form.querySelector('fieldset').disabled=!writable||busy;form.querySelector('button').disabled=!writable||busy||form.elements.presetId.options.length<2;}
  async function refresh(){
    const current=++sequence;
    const [history,eligible]=await Promise.all([api('/api/skins/gifts'),api('/api/skins/gifts/eligible')]);if(current!==sequence)return;
    if(!attempt&&!busy){
      const saved=form.elements.presetId.value;form.elements.presetId.replaceChildren(new Option('Choose a skin',''));
      for(const skin of eligible.skins)form.elements.presetId.add(new Option(`${skin.name} · ${skin.species}`,skin.id));
      form.elements.presetId.value=saved;
    }
    list.replaceChildren();
    for(const row of history.gifts){
      const sent=row.sender===user.steam_id,card=node('article','');
      card.append(node('h3',row.name),node('p',`${sent?'To':'From'} Steam ID ${sent?row.recipient:row.sender}`),node('p',row.note),node('p',`${row.state} · Expires ${new Date(row.expiresAt).toLocaleString()}`));
      if(row.state==='pending')for(const [decision,label]of sent?[['cancelled','Cancel offer']]:[['accepted','Accept gift'],['declined','Decline gift']]){
        const button=node('button',label);button.type='button';button.disabled=!writable;card.append(button);
        button.addEventListener('click',async()=>{
          if(!writable)return;
          if(decision==='accepted'&&!confirm(`Accept ${row.name}? This moves the sender’s unlock to your account.`))return;
          card.querySelectorAll('button').forEach(b=>b.disabled=true);
          try{await post('/decide',{id:row.id,decision,expectedRevision:row.revision});status.textContent=decision==='accepted'?'Gift accepted. The skin is now in My Skins.':decision==='cancelled'?'Gift offer cancelled.':'Gift declined.';await refresh();}
          catch(e){status.textContent=e.message;card.querySelectorAll('button').forEach(b=>b.disabled=!writable);}
        });
      }
      list.append(card);
    }
    if(!history.gifts.length)list.append(node('p','No gifts yet.'));
    if(eligible.limited)list.prepend(node('p','The skin chooser shows your 500 most recent unreserved unlocks.'));
    controls();
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(!writable||busy)return;
    const body={presetId:form.elements.presetId.value,recipientSteamId:form.elements.recipientSteamId.value.trim(),note:form.elements.note.value.trim()},signature=JSON.stringify(body);
    if(attempt?.signature!==signature)attempt={signature,body:{...body,requestId:crypto.randomUUID()}};
    busy=true;controls();
    try{await post('/offer',attempt.body);attempt=null;form.reset();status.textContent='Gift offered. You keep the skin until the recipient accepts.';busy=false;await refresh();}
    catch(e){status.textContent=e.message;}finally{busy=false;controls();}
  });
  $('gift-reconcile').addEventListener('click',async()=>{if(!writable)return;$('gift-reconcile').disabled=true;try{
    const result=await post('/reconcile',{cursor:recoveryCursor});recoveryCursor=result.nextCursor??0;
    status.textContent=result.pending?`${result.pending} skin application(s) still awaiting confirmation. No edit was resent.`:'No skin applications are waiting for confirmation.';
    if(result.nextCursor!=null)status.textContent+=' Select Check more applications to continue.';
    $('gift-reconcile').textContent=result.nextCursor!=null?'Check more applications':'Check pending skin applications';
    await refresh();
  }catch(e){status.textContent=e.message;}finally{$('gift-reconcile').disabled=!writable;}});
  $('gift-refresh').addEventListener('click',()=>refresh().catch(e=>{status.textContent=e.message;}));
  (async()=>{try{
    const capability=await api('/api/skins/gifts/capabilities');if(!capability.enabled){status.textContent='Skin gifting is not open yet.';return;}
    user=(await loadMe())?.user;if(!user?.steam_id){$('gift-signin').hidden=false;status.textContent='Sign in to continue.';return;}
    writable=capability.readOnly===false;$('gift-account').hidden=false;await refresh();
    status.textContent=writable?'Choose a skin to offer or review your incoming gifts.':'This preview is read-only. You can browse gifts, but cannot change them.';
  }catch(e){status.textContent=e.message;}})();
})();
