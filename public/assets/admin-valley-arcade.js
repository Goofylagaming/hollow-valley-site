"use strict";
const el=id=>document.getElementById(id);
const path="/api/valley-arcade/settings";
function show(settings){
  el("enabled").checked=Boolean(settings.enabled);el("emergency").checked=Boolean(settings.emergency);
  el("unlimited").checked=settings.cap===null;el("cap").value=settings.cap??250000;
  el("cap").disabled=el("unlimited").checked;el("settings").hidden=false;
}
fetch(path).then(r=>{if(!r.ok)throw Error();return r.json();}).then(show).catch(()=>el("status").textContent="Arcade settings unavailable.");
el("unlimited").onchange=()=>el("cap").disabled=el("unlimited").checked;
el("settings").onsubmit=async e=>{
  e.preventDefault();
  try{
    const cap=el("unlimited").checked?null:el("cap").valueAsNumber;
    if(cap!==null&&(!Number.isSafeInteger(cap)||cap<0))throw Error();
    const r=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({cap,enabled:el("enabled").checked,emergency:el("emergency").checked})});
    if(!r.ok)throw Error();show(await r.json());el("status").textContent="Saved.";
  }catch{el("status").textContent="Unable to save settings.";}
};
