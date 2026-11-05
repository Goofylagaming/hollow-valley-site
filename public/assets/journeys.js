(()=>{
  const {api,loadMe}=window.HDS,$=id=>document.getElementById(id),status=$('journey-status');
  let settings=null,writable=false,busy=false,bounds=null,points=[],cursor=null;
  const post=(path,body)=>api('/api/journeys'+path,{method:'POST',body:JSON.stringify(body)});
  function controls(){
    $('journey-optin').disabled=!writable||busy;$('journey-settings').querySelector('button').disabled=!writable||busy;
    $('journey-delete').disabled=!writable||busy;$('journey-refresh').disabled=busy;$('journey-more').disabled=busy;
  }
  function preference(){
    $('journey-optin').checked=settings.enabled;
    $('journey-preference').textContent=settings.enabled?'Recording is on for future observations.':'Recording is off. Any retained history is still available until it expires or you delete it.';
  }
  function render(){
    const select=$('journey-life'),selected=select.value,groups=new Map();
    for(const p of points)if(!groups.has(p.lifeId))groups.set(p.lifeId,p.at);
    select.replaceChildren();for(const [id,at]of groups)select.add(new Option(`Observed near ${new Date(at).toLocaleString()}`,id));
    if(groups.has(selected))select.value=selected;
    const rows=points.filter(p=>p.lifeId===select.value).sort((a,b)=>a.at-b.at),g=$('journey-lines');g.replaceChildren();
    let previous=null,metres=0,drawn=0;
    const svg=(tag,attrs)=>{const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value]of Object.entries(attrs))el.setAttribute(key,value);g.append(el);};
    for(const p of rows){
      const x=(p.y-bounds.minY)/(bounds.maxY-bounds.minY)*1000,y=(p.x-bounds.minX)/(bounds.maxX-bounds.minX)*1000;
      if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>1000||y<0||y>1000){previous=null;continue;}
      if(previous&&!p.breakBefore){svg('path',{d:`M${previous.x},${previous.y} L${x},${y}`});metres+=Math.hypot(p.x-previous.p.x,p.y-previous.p.y)/100;}
      svg('circle',{cx:x,cy:y,r:3});previous={x,y,p};drawn++;
    }
    $('journey-summary').textContent=rows.length?`${rows.length} loaded observations in this segment; ${(metres/1000).toFixed(2)} km between connected samples. ${rows.length-drawn} point(s) outside map bounds are not drawn.`:'No recorded observations yet.';
    $('journey-more').hidden=cursor===null;
  }
  async function history(older=false){
    const data=await api('/api/journeys/points'+(older&&cursor!==null?'?before='+cursor:''));
    points=older?[...points,...data.points]:data.points;cursor=data.nextBefore;render();
  }
  async function action(fn){if(busy)return;busy=true;controls();try{await fn();}catch(e){status.textContent=e.message;}finally{busy=false;controls();}}
  $('journey-settings').addEventListener('submit',event=>{event.preventDefault();if(!writable)return;const enabled=$('journey-optin').checked;action(async()=>{
    try{settings=await post('/settings',{enabled,expectedRevision:settings.revision});preference();status.textContent='Recording preference saved.';}
    catch(e){settings=await api('/api/journeys/settings');preference();throw e;}
  });});
  $('journey-delete').addEventListener('click',()=>{if(!writable||!confirm('Delete all your journey history and stop recording? This cannot be undone.'))return;action(async()=>{
    try{settings=await post('/delete',{expectedRevision:settings.revision});preference();await history();status.textContent='Journey history deleted. Recording is off.';}
    catch(e){settings=await api('/api/journeys/settings');preference();await history();throw e;}
  });});
  $('journey-refresh').addEventListener('click',()=>action(()=>history()));$('journey-more').addEventListener('click',()=>action(()=>history(true)));$('journey-life').addEventListener('change',render);
  (async()=>{try{
    const capability=await api('/api/journeys/capabilities');if(!capability.enabled){status.textContent='Journey history is not open yet.';return;}
    if(!(await loadMe())?.user?.steam_id){$('journey-signin').hidden=false;status.textContent='Sign in to continue.';return;}
    bounds=capability.mapBounds;settings=await api('/api/journeys/settings');writable=!capability.readOnly;preference();
    await history();$('journey-account').hidden=false;controls();status.textContent=writable?'Your journey history is private.':'This preview is read-only.';
  }catch(e){status.textContent=e.message;}})();
})();
