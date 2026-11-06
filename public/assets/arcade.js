'use strict';
(() => {
  const el=id=>document.getElementById(id);
  const pending=new Map();
  async function api(path,body,base='/api/arcade') {
    const response=await fetch(base+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'Sign in with Steam, or return when the Arcade is open.');
    return data;
  }
  async function act(name,payload={},base='/api/arcade') {
    const identity=base+name+JSON.stringify(payload);
    if(!pending.has(identity))pending.set(identity,crypto.randomUUID());
    const result=await api(name,{...payload,requestKey:pending.get(identity)},base);
    pending.delete(identity);return result;
  }
  const status=message=>{el('arcade-status').textContent=message;};
  function node(tag,text){const n=document.createElement(tag);n.textContent=text;return n;}
  function button(text,action){const b=node('button',text);b.onclick=async()=>{
    b.disabled=true;try{await action();await refresh();}catch(e){status(e.message);}finally{b.disabled=false;}
  };return b;}
  function dropTable(rows){
    const details=document.createElement('details');details.append(node('summary','View exact odds'));
    const list=document.createElement('ul');
    for(const r of rows)list.append(node('li',`${r.label}: ${(r.probability*100).toFixed(4)}% (${r.weight} weight)${r.duplicateConversion?` · owned skin converts to ${r.duplicateConversion} VC`:''}${r.type==='skin'?` · duplicates: ${r.duplicate}`:''}`));
    details.append(list);return details;
  }
  let current;
  async function refresh(){
    current=await api('');el('arcade-content').hidden=false;
    el('progress').textContent=`Level ${current.level} / 100 · ${current.xp.toLocaleString()} XP · ${current.balance.toLocaleString()} VC`;
    el('xp').value=current.level===100?500:current.xp%500;
    el('plays').textContent=`${current.playsRemaining} free plays remaining today`;
    el('daily').disabled=current.dailyClaimed;el('daily').textContent=current.dailyClaimed?'Daily reward claimed':'Claim daily XP + fragment';
    el('play').disabled=current.playsRemaining===0;
    el('crates').replaceChildren(...current.crates.map(c=>{
      const card=node('article','');card.className='arcade-card';card.append(node('h3',`${c.family.toUpperCase()} crate`),dropTable(c.odds),button('Open earned crate',async()=>{
        const result=await act('/open',{crateId:c.id});status(`Collected: ${result.reward.label}`);
      }));return card;
    }));
    if(!current.crates.length)el('crates').append(node('p','No unopened crates yet. Complete challenges or collect fragments.'));
    el('catalog').replaceChildren(...current.catalog.map(c=>{
      const count=current.fragments.find(f=>f.family===c.family)?.quantity||0;
      const card=node('article','');card.className='arcade-card';
      const craft=button('Combine fragments',async()=>{await act('/craft',{family:c.family});status('Earned crate added.');});
      craft.disabled=count<current.fragmentCosts[c.family];
      card.append(node('h3',c.family.toUpperCase()),node('p',`${count} / ${current.fragmentCosts[c.family]} fragments`),dropTable(c.odds),craft);return card;
    }));
    el('entitlements').replaceChildren(...current.entitlements.map(e=>{
      const delivery=(current.deliveries||[]).find(d=>d.entitlement_id===e.id);
      const label=delivery?.status==='delivered'?`Delivered to DinoStorage · slot ${delivery.slot}`:
        delivery?.message||(current.deliveryEnabled?'Queued for automatic DinoStorage delivery':'Delivery is paused; your reward remains owned');
      return node('li',`${e.reward.species} · ${e.reward.growthPercent}% growth · ${label} · ${e.id}`);
    }));
    if(!current.entitlements.length)el('entitlements').append(node('li','No dinosaur entitlements yet.'));
    el('history').replaceChildren(...current.history.map(h=>node('li',`${new Date(h.opened_at).toLocaleString()} · ${h.family} · ${h.reward.label}`)));
  }
  el('daily').onclick=async()=>{el('daily').disabled=true;try{await act('/daily');await refresh();status('Daily reward collected.');}catch(e){status(e.message);el('daily').disabled=false;}};
  el('play').onclick=async()=>{
    el('play').disabled=true;
    try{
      const round=await act('/start',{game:el('game').value},'/api/valley-arcade');
      el('question').textContent=round.prompt;
      el('answers').replaceChildren(...round.choices.map(choice=>button(choice,async()=>{
        const result=await api('/answer',{id:round.id,choice},'/api/valley-arcade');
        el('answers').replaceChildren();status(result.score?`Challenge complete · ${result.payout} VC plus XP and a fragment`:'No correct answer this time. Your owned rewards are safe.');
      })));
    }catch(e){status(e.message);el('play').disabled=false;}
  };
  refresh().then(()=>status('Ready to play.')).catch(e=>status(e.message));
})();
