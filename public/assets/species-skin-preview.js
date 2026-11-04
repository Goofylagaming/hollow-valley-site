'use strict';
window.__HV_SPECIES_READY=(async()=>{
 const response=await fetch('/assets/skin-models/species-staging/catalog.json');if(!response.ok)throw Error('Species catalog unavailable');
 const catalog=await response.json(),select=document.getElementById('preview-species');
 const id=new URLSearchParams(location.search).get('species');const species=catalog.species.find(s=>s.id===id)||catalog.species[0];
 for(const s of catalog.species){const option=document.createElement('option');option.value=s.id;option.textContent=s.name;select.append(option);}
 const rex=document.createElement('option');rex.value='tyrannosaurus';rex.textContent='Tyrannosaurus (verified pattern controls)';select.append(rex);
 select.value=species.id;
 select.addEventListener('change',()=>{location.href=select.value==='tyrannosaurus'?'/premium-skin-preview.html':'/species-skin-preview.html?species='+encodeURIComponent(select.value)+'&palette='+encodeURIComponent(document.querySelector('#premium-draft-choices [aria-pressed="true"]')?.dataset.palette||'0');});
 const draftsResponse=await fetch('/assets/premium-skin-drafts.json',{cache:'no-store'});if(!draftsResponse.ok)throw Error('Draft palettes unavailable');
 const pack=await draftsResponse.json();const buttons=[];
 const core=window.HVSkinStudioCore;
 for(const entry of pack.skins){const skin=Object.fromEntries(core.COLOR_KEYS.map(k=>[k,core.hexToColor(entry.colors[k])]));for(const k of core.INDEX_KEYS)skin[k]=entry[k];core.validateDocument(core.createDocument({name:entry.name,description:entry.description,species:pack.species,skin}));}
 function show(index){const entry=pack.skins[index];const detail={name:entry.name,species:species.id,sex:'male',colorSpace:'native-linear',skin:{...entry.colors}};
 window.__HV_STUDIO_PREVIEW=detail;document.getElementById('premium-preview-name').textContent=entry.name+' · '+species.name;buttons.forEach((b,i)=>b.setAttribute('aria-pressed',String(i===index)));document.dispatchEvent(new CustomEvent('hds:skin-preview-change',{detail}));}
 pack.skins.forEach((entry,index)=>{const b=document.createElement('button');b.className='hv-button';b.type='button';b.textContent=entry.name;b.dataset.palette=String(index);b.addEventListener('click',()=>show(index));buttons.push(b);document.getElementById('premium-draft-choices').append(b);});
 const requested=Number(new URLSearchParams(location.search).get('palette'));show([0,1,2].includes(requested)?requested:0);
 document.getElementById('status').textContent='21 additional supplied dinosaurs. Three unpublished palettes each. In-game verification pending.';
 return species;
})();
window.__HV_SPECIES_READY.catch(error=>{document.getElementById('status').textContent=error.message;document.getElementById('hv-viewer-empty').textContent='Preview unavailable. Reload to retry.';});
