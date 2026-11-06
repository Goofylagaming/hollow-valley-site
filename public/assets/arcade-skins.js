'use strict';
(async()=>{
  const defs=await(await fetch('/assets/arcade-skins.json?v=1')).json();let selected=defs[0];
  const el=id=>document.getElementById(id);
  function preview(def){selected=def;el('selected-name').textContent=def.name;
    document.querySelectorAll('[data-skin]').forEach(n=>n.classList.toggle('selected-skin',n.dataset.skin===def.id));
    const detail={name:def.name,species:el('preview-species').value,patternIndex:def.patternIndex,sex:'male',skin:def.colors};
    window.__HV_STUDIO_PREVIEW=detail;document.dispatchEvent(new CustomEvent('hds:skin-preview-change',{detail}));
  }
  for(const def of defs){const card=document.createElement('article');card.className='arcade-card';card.dataset.skin=def.id;
    const name=document.createElement('h2');name.textContent=def.name;const desc=document.createElement('p');desc.textContent=def.description;
    const swatches=document.createElement('div');swatches.className='skin-swatches';
    for(const key of ['body','markings','flank','underbelly','detail1','maleDisplay']){const s=document.createElement('span');s.style.background=def.colors[key];s.title=key+' '+def.colors[key];swatches.append(s);}
    const button=document.createElement('button');button.textContent='Preview '+def.name;button.onclick=()=>preview(def);
    card.append(name,swatches,desc,button);el('skin-cards').append(card);
  }
  el('preview-species').onchange=()=>preview(selected);preview(selected);
})().catch(()=>{document.getElementById('hv-viewer-status').textContent='Skin previews are unavailable. Please try again.';});
