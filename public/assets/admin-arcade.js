'use strict';
(() => {
  const el=id=>document.getElementById(id);let version;
  async function api(path='',body){
    const response=await fetch('/api/arcade/admin'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
    const value=await response.json().catch(()=>({}));if(!response.ok)throw Error(value.error||'Admin Arcade unavailable');return value;
  }
  async function load(){const s=await api();version=s.config.version;
    const {version:_,...config}=s.config;el('config').value=JSON.stringify(config,null,2);
    el('totals').textContent=`${s.totals.earned} earned crates · ${s.totals.opened} openings · ${s.coinsAwarded} VC awarded`;
    el('audit').textContent=s.audit.map(a=>`${new Date(a.created_at).toISOString()} ${a.actor} ${a.action}\n${a.details_json}`).join('\n\n');el('admin-content').hidden=false;
  }
  for(const [id,action] of [['config-form',()=>api('/configure',{config:JSON.parse(el('config').value),expectedVersion:version})],['grant-form',()=>{
    const b=Object.fromEntries(new FormData(el('grant-form')));b.amount=Number(b.amount);return api('/grant',b);
  }]])el(id).onsubmit=async event=>{event.preventDefault();const b=event.submitter;b.disabled=true;
    try{await action();await load();el('arcade-status').textContent='Saved.';}catch(e){el('arcade-status').textContent=e.message;}finally{b.disabled=false;}
  };
  load().then(()=>el('arcade-status').textContent='').catch(e=>el('arcade-status').textContent=e.message);

  const availabilityStatus=document.getElementById('availability-status');
  function showAvailability(settings){
    el('enabled').checked=Boolean(settings.enabled);
    el('emergency').checked=Boolean(settings.emergency);
    el('unlimited').checked=settings.cap===null;
    el('cap').value=settings.cap??250000;
    el('cap').disabled=el('unlimited').checked;
  }
  el('unlimited').addEventListener('change',()=>{el('cap').disabled=el('unlimited').checked;});
  fetch('/api/valley-arcade/settings').then(async response=>{
    const value=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(value.error||'Arcade availability settings are unavailable.');
    showAvailability(value);
  }).catch(error=>{availabilityStatus.textContent=error.message;});
  document.getElementById('availability').addEventListener('submit',async event=>{
    event.preventDefault();
    const button=event.submitter;button.disabled=true;
    try{
      const cap=el('unlimited').checked?null:el('cap').valueAsNumber;
      if(cap!==null&&(!Number.isSafeInteger(cap)||cap<0)) throw new Error('Enter a whole-number cap, or choose Unlimited.');
      const response=await fetch('/api/valley-arcade/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cap,enabled:el('enabled').checked,emergency:el('emergency').checked})});
      const value=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(value.error||'Unable to save availability.');
      showAvailability(value);
      availabilityStatus.textContent='Availability saved.';
    }catch(error){availabilityStatus.textContent=error.message;}
    finally{button.disabled=false;}
  });
})();
