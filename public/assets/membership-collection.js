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
  if(preferences.beta_opt_in){
    const preview=document.createElement("details");
    const label=document.createElement("summary");label.textContent="Beta · Collection filter";preview.append(label);
    const input=document.createElement("input");input.type="search";input.placeholder="Filter collectible names";
    input.setAttribute("aria-label","Filter collectible names");const matches=document.createElement("ul");
    function filter(){
      const results=book.collectibles.filter(i=>i.name.toLowerCase().includes(input.value.toLowerCase()));
      matches.replaceChildren(...results.map(i=>{const li=document.createElement("li");li.textContent=i.name+" · "+(i.earned_at?"Owned":"Locked");return li;}));
    }
    input.oninput=filter;filter();preview.append(input,matches);panel.append(preview);
  }
  const digestResponse=await fetch("/api/membership-growth/digest");
  if(digestResponse.ok){
    const digest=await digestResponse.json();
    const entries=["Monthly Valley Coin tier bonus: "+digest.monthlyCoins,"Premium choices remaining: "+digest.skinChoices,"Verified paid months: "+digest.paidMonths];
    for(const value of [digest.season,digest.nextMilestone,digest.vote,digest.publicEvent]) if(value) entries.push(value);
    for(const title of digest.preview||[])entries.push("Upcoming preview · "+title);
    for(const title of digest.shipped||[])entries.push("Shipped · "+title);
    section("Subscriber digest · "+digest.month,entries);
    const prefs=await fetch("/api/membership-growth/digest/preferences");
    if(prefs.ok){
      const check=document.createElement("input");check.type="checkbox";check.checked=(await prefs.json()).enabled;
      const label=document.createElement("label");label.append(check,document.createTextNode(" Receive my monthly digest here"));panel.append(label);
      const delivery=async()=>{
        const saved=await fetch("/api/membership-growth/digest/deliver",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
        if(!saved.ok) throw Error();
      };
      check.onchange=async()=>{
        check.disabled=true;
        try{
          const r=await fetch("/api/membership-growth/digest/preferences",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:check.checked})});
          if(!r.ok) throw Error();if(check.checked) await delivery();
          status.textContent="Digest preference saved.";
        }catch{status.textContent="Unable to confirm digest preference. Reload to check.";}finally{check.disabled=false;}
      };
      if(check.checked) await delivery();
    }
    const previews=await fetch("/api/membership-growth/previews");
    if(previews.ok){const items=await previews.json();if(items.length)section("Previews and releases",items.map(i=>i.title+" · "+i.body));}
  }
})().catch(() => {});
