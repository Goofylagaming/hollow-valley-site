/* Read-only, privacy-preserving community activity; stale means unknown, not offline. */
(function(){
  "use strict";
  const {api,loadMe}=window.HDS;
  const $=id=>document.getElementById(id);
  function node(tag,text,cls){
    const e=document.createElement(tag);
    if(cls)e.className=cls;
    if(text!==undefined)e.textContent=String(text);
    return e;
  }
  function stamp(value){
    const d=new Date(value);
    return value&&Number.isFinite(d.getTime()) ? d.toLocaleString("en-AU",{
      dateStyle:"medium",timeStyle:"short",timeZone:"Australia/Brisbane"
    })+" AEST":"Not verified";
  }
  function showServer(entry){
    const name={
      online:"Online",offline:"Offline (verified)",
      delayed:"Status delayed",unconfigured:"Not configured",
    };
    $("hv-activity-state").textContent=name[entry?.state]||"Unavailable";
    $("hv-activity-online").textContent=entry?.playersOnline==null?"—":
      String(entry.playersOnline)+" / "+String(entry.maxPlayers??"—");
    $("hv-activity-last").textContent=stamp(entry?.checkedAt);
    $("hv-activity-checked").textContent=entry?.state==="delayed"
      ? "The last known website snapshot is delayed; no current online/offline claim is available."
      : "Game server status comes from the automation platform's latest checked snapshot.";
  }
  function showActivity(entry){
    const good=entry?.available===true;
    const stale=entry?.stale===true;
    const verified=good && !stale;
    $("hv-activity-unique").textContent=good?String(entry.uniquePlayers):"—";
    $("hv-activity-average").textContent=good?String(entry.averageOnline):"—";
    $("hv-activity-peak").textContent=good?String(entry.peakConcurrent):"—";
    $("hv-activity-metrics-status").textContent=!good
      ? "No verified activity samples are available in this window."
      : (stale?"Last activity sample delayed. These are historical totals, not a current live count.":"Verified history available.")+
        " "+entry.sampleCount+" samples · last sample "+stamp(entry.lastVerifiedAt);
    const host=$("hv-activity-trend");host.replaceChildren();
    const trend=Array.isArray(entry?.activityTrend)?entry.activityTrend:[];
    const high=Math.max(1,...trend.map(p=>Number(p.peakPlayers)||0));
    for(const entry of trend){
      const div=node("div",undefined,"bar");
      const height=Math.max(2,Math.min(100,Math.round((Number(entry.averagePlayers)||0)/high*100)));
      div.style.setProperty("--bar-height",height+"%");
      div.title=stamp(entry.startedAt)+" · average "+entry.averagePlayers+" players";
      host.append(div);
    }
    if(!trend.length)host.append(node("p","No verified trend samples to display."));
    const species=$("hv-activity-species");species.replaceChildren();
    for(const item of Array.isArray(entry?.topSpecies)?entry.topSpecies:[]){
      species.append(node("span",item.species+" · "+item.samplePlayerCount+" sampled observations"));
    }
    if(!species.children.length)species.append(node("p","No observed species distribution is available."));
  }
  function showEvents(entry){
    const host=$("hv-activity-events");host.replaceChildren();
    const ok=entry?.available===true && entry?.stale===false;
    $("hv-activity-events-status").textContent=ok
      ? "Fresh Discord events snapshot checked "+stamp(entry.syncedAt)+"."
      : "Discord event schedule unavailable or delayed. See the dedicated Events page for the latest information.";
    if(!ok)return;
    const events=Array.isArray(entry.upcoming)?entry.upcoming:[];
    if(!events.length)host.append(node("p","No scheduled events were returned by the verified feed."));
    for(const e of events){
      const card=node("article",undefined,"hv-activity-event");
      card.append(node("strong",e.title),node("small",stamp(e.startTime)));
      if(e.location)card.append(node("p","Location: "+e.location));
      if(typeof e.url==="string" &&
          /^https:\/\/discord\.com\/events\/\d{10,24}\/\d{10,24}$/.test(e.url)){
        const a=node("a","Event details ↗");a.href=e.url;a.rel="noopener noreferrer";a.target="_blank";
        card.append(a);
      }
      host.append(card);
    }
  }
  function showResults(entries){
    const host=$("hv-activity-results");host.replaceChildren();
    const rows=Array.isArray(entries)?entries:[];
    if(!rows.length)host.append(node("p","No staff-confirmed event results have been published yet."));
    for(const r of rows){
      const card=node("article",undefined,"hv-activity-result");
      card.append(
        node("small","Staff-published summary · "+stamp(r.eventAt)),
        node("strong",r.title),node("p",r.summary)
      );
      if(Array.isArray(r.winners)&&r.winners.length)card.append(
        node("p","Winner display names: "+r.winners.join(", "))
      );
      card.append(node("small","Not an automatic payout or in-game combat verification"));
      host.append(card);
    }
  }
  async function pack(){
    try{
      const me=await loadMe();
      if(!me?.loggedIn || !/^\d{17}$/.test(String(me.user?.steam_id||""))){
        $("hv-activity-pack").textContent="Sign in with Steam to view your website group details. In-game party verification is not yet available.";
        return;
      }
      const info=await api("/api/community-activity/pack-context");
      const parts=[
        info.websiteGroup
          ? "Website group: "+info.websiteGroup.name+" · "+info.websiteGroup.members+
            " / "+info.websiteGroup.capacity+" members."
          : "You are not in a website group.",
        info.myLiveSpecies ? "Your current observed dinosaur species: "+info.myLiveSpecies+"."
          : "Your current dinosaur species is not verified right now.",
        info.publishedSingleSpeciesLimit==null
          ? "No approved single-species pack limit is matched to your dinosaur."
          : "Published single-species limit: "+info.publishedSingleSpeciesLimit+
            " (policy version "+info.policyVersion+").",
        "In-game party composition: NOT VERIFIED. Website membership is not proof of group size or compliance.",
      ];
      $("hv-activity-pack").textContent=parts.join("\n");
    }catch{
      $("hv-activity-pack").textContent="Your website group context is temporarily unavailable. In-game pack compliance cannot be verified.";
    }
  }
  async function refresh(){
    const button=$("hv-activity-refresh");button.disabled=true;
    try{
      const params=new URLSearchParams({hours:$("hv-activity-hours").value});
      const data=await api("/api/community-activity?"+params);
      showServer(data.server);showActivity(data.activity);
      showEvents(data.events);showResults(data.eventResults);
    }catch{
      $("hv-activity-state").textContent="Unavailable";
      $("hv-activity-online").textContent="—";
      $("hv-activity-checked").textContent="Unable to retrieve a verified source snapshot.";
      $("hv-activity-metrics-status").textContent="Activity history unavailable.";
      $("hv-activity-events-status").textContent="Event schedule unavailable.";
      $("hv-activity-results").textContent="Event history unavailable.";
    }finally{button.disabled=false;}
  }
  function init(){
    $("hv-activity-refresh").addEventListener("click",refresh);
    $("hv-activity-hours").addEventListener("change",refresh);
    refresh();pack();
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);
  else init();
})();
