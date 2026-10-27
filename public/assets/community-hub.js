/* Hollow Valley community hub: public published groups and conditional Legacy nest listings. */
(function(){
  "use strict";
  const $=id=>document.getElementById(id);
  const {api,loadMe}=window.HDS;
  function el(tag,text,cls){
    const n=document.createElement(tag);
    if(cls)n.className=cls;
    if(text!==undefined)n.textContent=String(text);
    return n;
  }
  function entry(name,body,meta,destination){
    const card=el("article",undefined,"hv-group-card");
    card.append(el("small",meta),el("strong",name),el("p",body));
    const link=el("a","View details ↗");link.href=destination;card.append(link);
    return card;
  }
  async function groups(){
    const host=$("hv-community-groups");
    try{
      const data=await api("/api/group-recruitment?limit=6");
      const rows=Array.isArray(data.groups)?data.groups:[];
      host.replaceChildren();
      if(!rows.length)host.append(el("p","No website groups have opted in to recruitment yet."));
      for(const group of rows){
        host.append(entry(group.groupName,group.description,group.members+" / "+group.capacity+" members · "+group.style,
          "/recruitment"));
      }
      $("hv-community-group-status").textContent=rows.length+" group(s) currently advertising on the website.";
    }catch{
      $("hv-community-group-status").textContent="Group listings are temporarily unavailable.";
    }
  }
  async function nests(){
    const host=$("hv-community-nests");
    try{
      const me=await loadMe();
      if(!me?.valleyLegacyEnabled){
        $("hv-community-nest-status").textContent="Valley Legacy nesting listings are not enabled yet.";
        host.replaceChildren();
        return;
      }
      const data=await api("/api/legacy");
      const rows=Array.isArray(data.nests)?data.nests:[];
      host.replaceChildren();
      if(!rows.length)host.append(el("p","No verified open nesting listings right now."));
      for(const nest of rows.slice(0,6)){
        host.append(entry(nest.name||"Open nest",
          String(nest.remaining??"—")+" of "+String(nest.eggs??"—")+" advertised eggs available",
          nest.species||"Species not specified","/legacy#nests"));
      }
      $("hv-community-nest-status").textContent=rows.length+" open nest listing(s) from Valley Legacy.";
    }catch{
      $("hv-community-nest-status").textContent="Nest listings could not be verified at this time.";
      host.replaceChildren();
    }
  }
  function start(){groups();nests();}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start);
  else start();
})();
