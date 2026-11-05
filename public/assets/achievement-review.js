(() => {
  const root=document.getElementById('achievement-review');
  if(!root) return;
  const select=root.querySelector('select'),details=root.querySelector('[data-details]'),form=root.querySelector('form');
  const message=root.querySelector('[role=status]'),refresh=root.querySelector('[data-refresh]');
  const reason=form.elements.reason,decision=form.elements.decision,save=form.querySelector('button');
  const url='/api/admin-operations/achievement-reviews';
  let rows=[],pending=null,busy=false;
  function controls() {refresh.disabled=busy;select.disabled=busy;save.disabled=busy||!select.value;reason.disabled=busy;decision.disabled=busy;}
  function selected() {
    const row=rows[Number(select.value)];
    details.replaceChildren();
    const line=text=>{const p=document.createElement('p');p.textContent=text;details.append(p);};
    if(select.value!==''&&row) {
      line(`Player ${row.steamId} · Award ${row.awardStatus} · ${row.pendingCount} evidence items awaiting review`);
      if(row.award) {
        line(`Originally awarded: ${row.award.unlockedAt}`);
        let evidence;try{evidence=JSON.parse(row.award.metadata).evidence;}catch{}
        if(evidence) {
          line(`Recorded life: ${evidence.lifeId}`);
          for(const [key,label] of [['juvenileAt','Juvenile observed'],['adultAt','Adult observed'],['observedThrough','Survival observed through']]) if(Number.isFinite(evidence[key])) line(`${label}: ${new Date(evidence[key]).toLocaleString()}`);
        }
      }
      const labels={'combat-death':'Combat death','legacy-death':'Legacy death','life-ended-early':'Life ended before qualifying milestone','life-identity':'Life identity mismatch'};
      for(const item of row.evidence||[]) line(`${labels[item.kind]||item.kind}: ${item.id} · ${item.status}${item.occurredAt!=null?` · occurred ${new Date(item.occurredAt).toLocaleString()}`:''} · detected ${new Date(item.detectedAt).toLocaleString()}`);
      line('Decision history');
      for(const item of row.decisions||[]) line(`${new Date(item.createdAt).toLocaleString()} · ${item.actorSteamId} · ${item.decision==='withdraw'?'Withdrawn':'Upheld / restored'}: ${item.reason}`);
      if(!row.decisions?.length) line('No decisions recorded.');
    } else line('Select an achievement to inspect its evidence and decision history.');
    controls();
  }
  async function request(options) {
    const response=await fetch(url,{credentials:'same-origin',...options});
    const data=await response.json();
    if(!response.ok) throw new Error(data.error||'Review request failed');
    return data;
  }
  async function load() {
    const data=await request();rows=data.reviews||[];select.replaceChildren(new Option('Select an achievement',''));
    rows.forEach((row,i)=>select.add(new Option(`${row.steamId} · ${row.achievementId} · ${row.pendingCount} pending · ${row.awardStatus}`,String(i))));
    selected();
  }
  refresh.addEventListener('click',async()=>{
    busy=true;controls();message.textContent='Loading reviews…';
    try {await load();message.textContent=rows.length?'Reviews loaded.':'No achievement reviews found.';}
    catch(error){message.textContent=error.message;}
    finally {busy=false;controls();}
  });
  select.addEventListener('change',()=>{reason.value='';selected();});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!select.value)return;
    const row=rows[Number(select.value)];
    const body={steamId:row.steamId,achievementId:row.achievementId,expectedRevision:row.revision,decision:decision.value,reason:reason.value.trim()};
    if(body.reason.length<10){message.textContent='Explain your decision in at least 10 characters.';return;}
    const signature=JSON.stringify(body);
    if(pending?.signature!==signature) pending={signature,requestId:crypto.randomUUID()};
    busy=true;controls();message.textContent='Saving decision…';
    try {
      await request({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,requestId:pending.requestId})});
      pending=null;reason.value='';
      // A successful write remains successful even if the subsequent refresh fails.
      select.value='';selected();
      message.textContent='Decision recorded.';
      try {await load();} catch {message.textContent='Decision recorded. Refresh to load the latest reviews.';}
    } catch(error){message.textContent=error.message;}
    finally {busy=false;controls();}
  });
  controls();
})();
