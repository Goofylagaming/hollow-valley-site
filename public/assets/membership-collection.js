"use strict";

(async function renderCollection() {
  const panel = document.getElementById("membership-collection");
  const response = await fetch("/api/supporter/rewards/collection");
  if (!response.ok) return;
  const book = await response.json();
  function section(name, entries) {
    const heading = document.createElement("h3");
    heading.textContent = name;
    panel.append(heading);
    const list = document.createElement("ul");
    for (const entry of entries) {
      const item = document.createElement("li");
      item.textContent = entry;
      list.append(item);
    }
    panel.append(list);
  }
  section("Passport", [book.passport.lifetime + " lifetime verified paid months", book.passport.consecutive + " consecutive paid months"]);
  section("Permanently claimed premium skins", book.skins.length ? book.skins.map(s => s.skin_id) : ["No claims recorded"]);
  section("Loyalty titles", book.milestones.map(m => m.title + (book.loyalty.some(l => l.months === m.months) ? " · Owned" : " · Locked")));
  if (book.collectibles.length) section("Collectibles", book.collectibles.map(c => c.name + (c.earned_at ? " · Owned" : " · Locked")));
  section("Verified achievements", book.achievementIds?.length ? book.achievementIds : [book.achievementIds===null ? "Temporarily unavailable" : "No verified achievements yet"]);
  const form=document.createElement("form");
  const owned=book.collectibles.filter(item=>item.earned_at);
  const controls={};
  const preferences=book.preferences;
  function field(key,label,element){
    const wrapper=document.createElement("label");
    wrapper.textContent=label+" ";
    wrapper.append(element);form.append(wrapper,document.createElement("br"));controls[key]=element;
  }
  for(const [key,label,items] of [
    ["accent","Accent",owned.filter(i=>i.kind==="accent")],["banner","Banner",owned.filter(i=>i.kind==="banner")],
    ["featured_skin","Featured premium skin",book.skins.map(s=>({slug:s.skin_id,name:s.skin_id}))],
    ["featured_title","Featured title",[...owned.filter(i=>i.kind==="title"),...book.loyalty.map(i=>({slug:i.title,name:i.title}))]],
    ["featured_achievement","Featured achievement",[...owned.filter(i=>i.kind==="achievement"),...(book.achievementIds||[]).map(slug=>({slug,name:slug}))]]
  ]){
    const select=document.createElement("select");select.add(new Option("None",""));
    for(const item of items) select.add(new Option(item.name,item.slug));
    select.value=preferences[key]||"";field(key,label,select);
  }
  for(const [key,label] of [["favourite_dinosaur","Favourite dinosaur"],["display_alias","Supporter wall alias"]]){
    const input=document.createElement("input");input.maxLength=32;input.value=preferences[key]||"";field(key,label,input);
  }
  for(const [key,label] of [["beta_opt_in","Preview selected website and overlay features"],["wall_opt_in","Show my alias on the supporter wall"]]){
    const input=document.createElement("input");input.type="checkbox";input.checked=Boolean(preferences[key]);field(key,label,input);
  }
  const save=document.createElement("button");save.textContent="Save preferences";
  const status=document.createElement("p");status.setAttribute("role","status");form.append(save,status);panel.append(form);
  form.onsubmit=async event=>{
    event.preventDefault();save.disabled=true;
    try{
      const payload=Object.fromEntries(Object.entries(controls).map(([key,el])=>[key,el.type==="checkbox"?el.checked:el.value]));
      const response=await fetch("/api/supporter/rewards/collection/preferences",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      status.textContent=response.ok?"Preferences saved.":"Unable to save. Check your selections.";
    }catch{status.textContent="Connection unavailable. Retry to save.";}finally{save.disabled=false;}
  };
  panel.hidden = false;
})().catch(() => {});
