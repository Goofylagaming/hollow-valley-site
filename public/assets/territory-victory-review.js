(() => {
  const list=document.getElementById('victory-delivery-list');
  if(!list) return;
  const choice=document.getElementById('victory-delivery-choice');
  const button=document.getElementById('victory-delivery-retry');
  const status=document.getElementById('victory-delivery-status');
  const reason=document.getElementById('victory-delivery-reason');
  const base='/api/territory-wars/admin/victory-delivery';
  let busy=false;
  async function request(url,options) {
    const response=await fetch(url,{credentials:'same-origin',...options});
    const body=await response.json();
    if(!response.ok) throw new Error(body.error||'Delivery review unavailable');
    return body;
  }
  async function load() {
    choice.disabled=true;button.disabled=true;
    try {
      const {deliveries}=await request(base);
      list.replaceChildren();choice.replaceChildren();
      for(const row of deliveries) {
        const text=document.createElement('p');
        text.textContent=`Battle ${row.attackId}: ${row.status} · ${row.attempts} delivery attempts${row.errorCode?' · '+row.errorCode:''}`;
        list.append(text);
        if(row.status!=='delivered') {
          const option=document.createElement('option');option.value=String(row.attackId);
          option.textContent=`Battle ${row.attackId} (${row.status})`;choice.append(option);
        }
      }
      if(!deliveries.length) list.textContent='No victory results have been queued.';
      choice.disabled=button.disabled=busy||!choice.options.length;
      return true;
    } catch(error) {status.textContent=error.message;return false;}
  }
  document.getElementById('victory-delivery-refresh').addEventListener('click',()=>{if(!busy) load();});
  document.getElementById('victory-delivery-form').addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!choice.value) return;
    busy=true;button.disabled=true;choice.disabled=true;
    try {
      await request(`${base}/${encodeURIComponent(choice.value)}/retry`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:reason.value})});
      status.textContent='Retry queued. Delivery will resume when the relay is enabled.';reason.value='';
    } catch(error) {status.textContent=error.message;}
    finally {busy=false;await load();}
  });
  load();
})();
