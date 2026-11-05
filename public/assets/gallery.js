(() => {
  const {api,loadMe}=window.HDS,$=id=>document.getElementById(id);
  const cards=$('gallery-cards'),message=$('gallery-message'),upload=$('gallery-upload'),more=$('gallery-more');
  let user=null,view='public',cursor=null,sequence=0,uploadAttempt=null,uploadBusy=false,enabled=false;
  function controls(){upload.hidden=!enabled||view!=='mine'||!user?.steam_id;$('gallery-filter').hidden=!enabled||view!=='admin';}
  const node=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
  const button=(text,fn)=>{const e=node('button',text);e.type='button';e.className='small-button';e.addEventListener('click',fn);return e;};
  function reviewForm(row,card) {
    const form=node('form');form.className='gallery-review';
    const select=node('select');select.name='decision';for(const [value,label] of [['approved','Approve'],['rejected','Reject']])select.add(new Option(label,value));
    select.value=row.status==='rejected'?'rejected':'approved';
    const label=node('label','Decision');label.append(select);form.append(label);
    const check=node('input');check.type='checkbox';check.checked=row.featured;const featured=node('label');featured.append(check,document.createTextNode('Feature this screenshot'));form.append(featured);
    const reason=node('textarea');reason.required=true;reason.minLength=10;reason.maxLength=500;const why=node('label','Review reason');why.append(reason);form.append(why);
    const save=node('button','Record decision');save.type='submit';save.className='small-button';form.append(save);
    let attempt=null;
    form.addEventListener('submit',async event=>{
      event.preventDefault();const body={status:select.value,featured:select.value==='approved'&&check.checked,reason:reason.value.trim(),expectedRevision:row.revision};
      if(body.reason.length<10)return;
      const signature=JSON.stringify(body);if(attempt?.signature!==signature)attempt={signature,requestId:crypto.randomUUID()};
      save.disabled=true;
      try{await api(`/api/gallery/${encodeURIComponent(row.id)}/review`,{method:'POST',body:JSON.stringify({...body,requestId:attempt.requestId})});await load(false,'Decision recorded.');}
      catch(e){message.textContent=e.message;save.disabled=false;}
    });
    card.append(form);
    card.append(button('View decision history',async event=>{
      const control=event.currentTarget;control.disabled=true;
      try{const data=await api(`/api/gallery/${encodeURIComponent(row.id)}/history`);const list=node('div');
        for(const r of data.reviews)list.append(node('p',`${new Date(r.createdAt).toLocaleString()} · ${r.actorSteamId} · ${r.status}: ${r.reason}`));
        if(!data.reviews.length)list.append(node('p','No decisions recorded.'));card.append(list);
      }catch(e){message.textContent=e.message;control.disabled=false;}
    }));
  }
  function render(row) {
    const card=node('article');card.className='gallery-card';
    if(row.status!=='withdrawn'){const img=node('img');img.src=`/api/gallery/${encodeURIComponent(row.id)}/image`;img.alt=row.title;img.loading='lazy';img.width=row.width;img.height=row.height;card.append(img);}
    card.append(node('h2',row.title),node('p',`By ${row.author} · ${new Date(row.createdAt).toLocaleDateString()}`));
    if(row.featured)card.append(node('p','Featured screenshot'));
    if(row.status)card.append(node('p',`Status: ${row.status}`));
    if(view==='mine'&&row.status!=='withdrawn')card.append(button('Remove my screenshot',async event=>{
      if(!confirm('Permanently remove this image from the gallery? Its moderation history will remain.'))return;
      const control=event.currentTarget;control.disabled=true;
      try{await api(`/api/gallery/${encodeURIComponent(row.id)}`,{method:'DELETE'});await load(false,'Screenshot removed.');}
      catch(e){message.textContent=e.message;control.disabled=false;}
    }));
    if(view==='admin')reviewForm(row,card);
    cards.append(card);
  }
  async function load(append=false,success='') {
    const current=++sequence;more.disabled=true;
    if(!append){cursor=null;cards.replaceChildren();}
    const endpoint=['public','featured'].includes(view)?'/api/gallery':`/api/gallery/${view}`;
    const params=new URLSearchParams();if(append&&cursor)params.set('before',cursor);if(view==='featured')params.set('featured','1');if(view==='admin')params.set('status',$('gallery-status').value);
    message.textContent=success||'Loading screenshots…';
    try{
      const capabilities=await api('/api/gallery/capabilities');if(current!==sequence)return;
      enabled=capabilities.enabled===true;controls();
      if(!enabled){cards.replaceChildren();more.hidden=true;message.textContent='The gallery is not open yet. Check back after launch.';return;}
      const data=await api(endpoint+(params.size?`?${params}`:''));if(current!==sequence)return;
      for(const row of data.images)render(row);cursor=data.nextCursor;more.hidden=cursor===null;more.disabled=false;
      message.textContent=success||(!cards.children.length?'No screenshots in this view yet.':'Screenshots loaded.');
    }catch(e){if(current!==sequence)return;if(e.status===503){enabled=false;controls();}more.hidden=true;message.textContent=success?`${success} Refresh to load the latest images.`:e.message;}
  }
  document.querySelectorAll('[data-view]').forEach(tab=>tab.addEventListener('click',()=>{
    view=tab.dataset.view;document.querySelectorAll('[data-view]').forEach(t=>{t.classList.toggle('active',t===tab);t.setAttribute('aria-pressed',String(t===tab));});
    controls();load();
  }));
  $('gallery-refresh').addEventListener('click',()=>load());more.addEventListener('click',()=>load(true));
  $('gallery-status').addEventListener('change',()=>load());
  upload.addEventListener('submit',async event=>{
    event.preventDefault();if(uploadBusy||!enabled)return;
    const file=upload.elements.image.files[0],title=upload.elements.title.value.trim();
    if(!file||file.size>8*1024*1024){message.textContent='Choose an image up to 8 MB.';return;}
    if(!title)return;
    if(uploadAttempt?.file!==file||uploadAttempt?.title!==title)uploadAttempt={file,title,requestId:crypto.randomUUID()};
    uploadBusy=true;for(const e of upload.elements)e.disabled=true;
    message.textContent='Uploading screenshot…';
    try{
      await api(`/api/gallery?title=${encodeURIComponent(title)}`,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Upload-Id':uploadAttempt.requestId},body:file});
      upload.reset();uploadAttempt=null;await load(false,'Screenshot submitted. It stays private until approved.');
    }catch(e){message.textContent=e.message;}
    finally{uploadBusy=false;for(const e of upload.elements)e.disabled=false;}
  });
  (async()=>{
    try{user=(await loadMe())?.user;}catch{}
    $('gallery-signin').hidden=Boolean(user?.steam_id);
    document.querySelector('[data-view=mine]').hidden=!user?.steam_id;
    document.querySelector('[data-view=admin]').hidden=!user?.is_admin;
    if(new URLSearchParams(location.search).get('view')==='mine'&&user?.steam_id)document.querySelector('[data-view=mine]').click();else await load();
  })();
})();
