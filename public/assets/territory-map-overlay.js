(() => {
  const root = document.getElementById("territory-war-overlay-slot");
  const shapeLayer = document.getElementById("territory-war-shapes");
  if (!root || !shapeLayer) return;

  const $ = (selector) => root.querySelector(selector);
  const rotation = {N:0,NE:45,E:90,SE:135,S:180,SW:225,W:270,NW:315};
  let state = null;

  function esc(value){return String(value ?? "").replace(/[&<>"']/g,(ch)=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch]));}
  function clock(ms){const s=Math.max(0,Math.ceil(ms/1000));return `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;}

  function mountShell(){
    root.innerHTML = `
      <div class="tw-map-top">
        <div class="tw-side tw-owner"><small>Owner</small><strong data-tw-owner>—</strong></div>
        <div class="tw-timer"><span data-tw-phase>TERRITORY WARS</span><b data-tw-countdown>--:--</b><small data-tw-territory>—</small><em data-tw-event-state>EVENT ACTIVE</em></div>
        <div class="tw-side tw-challenger"><small>Challenger</small><strong data-tw-challenger>—</strong></div>
      </div>
      <div class="tw-left">
        <section class="tw-leader" data-tw-leader hidden>
          <header><small>Leader intel</small><b data-tw-side>SPECTATOR</b></header>
          <div class="tw-leader-grid">
            <div><small>Battlefield</small><b data-tw-battle>0 / 0</b></div>
            <div><small>Claim</small><b data-tw-claim>0 / 0</b></div>
            <div><small>Lineup</small><b data-tw-lineup>0</b></div>
          </div>
        </section>
        <section class="tw-admin" data-tw-admin hidden>
          <header><small>Admin fighters</small><b data-tw-fighter-count>0</b></header>
          <div class="tw-fighter-list" data-tw-fighters></div>
        </section>
      </div>
      <div class="tw-direction"><i data-tw-arrow>↑</i><div><small>Attacker direction</small><strong data-tw-direction>—</strong></div></div>
      <div class="tw-control">
        <div class="tw-control-copy"><span data-tw-owner-pct>100%</span><b data-tw-control-label>CONTROL</b><span data-tw-challenger-pct>0%</span></div>
        <div class="tw-control-track"><i class="tw-control-owner" data-tw-owner-bar></i><i class="tw-control-challenger" data-tw-challenger-bar></i><i class="tw-control-mid"></i></div>
      </div>`;
  }

  function renderTimer(){
    if(!state) return;
    const node=$("[data-tw-countdown]");
    const phase=state.timer?.phase||"idle";
    const t=state.timer?.endsAt?new Date(state.timer.endsAt).getTime():NaN;
    if(Number.isFinite(t)) node.textContent=clock(t-Date.now());
    else node.textContent=phase==="control-live"?"LIVE":phase==="waiting-claim"?"ARMED":"--:--";

    const phaseState=$("[data-tw-event-state]");
    if(phaseState){
      const copy={
        "attack-warning":"ATTACK WARNING",
        "claim-arming":"CLAIM ARMING",
        "waiting-claim":"CLAIM READY",
        "control-live":"CLAIM LIVE",
        "complete":"EVENT COMPLETE"
      };
      phaseState.textContent=copy[phase]||"EVENT ACTIVE";
    }
    const controlLabel=$("[data-tw-control-label]");
    if(controlLabel) controlLabel.textContent=phase==="control-live"?"CLAIM CONTROL":"CONTROL";
  }

  function renderZones(z){
    shapeLayer.dataset.phase=state?.timer?.phase||"idle";
    if(!z?.mapCenter || !z?.battlefieldMapRadius || !z?.claimMapRadius){shapeLayer.innerHTML="";return;}
    const cx=(z.mapCenter.left*1000).toFixed(1), cy=(z.mapCenter.top*1000).toFixed(1);
    const brx=(z.battlefieldMapRadius.x*1000).toFixed(1), bry=(z.battlefieldMapRadius.y*1000).toFixed(1);
    const crx=(z.claimMapRadius.x*1000).toFixed(1), cry=(z.claimMapRadius.y*1000).toFixed(1);
    shapeLayer.innerHTML=`
      <ellipse class="tw-zone-shape battlefield" cx="${cx}" cy="${cy}" rx="${brx}" ry="${bry}"><title>${esc(z.territoryName)} Battlefield</title></ellipse>
      <ellipse class="tw-zone-shape claim" cx="${cx}" cy="${cy}" rx="${crx}" ry="${cry}"><title>${esc(z.territoryName)} Claim Zone</title></ellipse>
      <text class="tw-zone-label" x="${cx}" y="${(Number(cy)-Number(bry)-8).toFixed(1)}" text-anchor="middle">BATTLEFIELD</text>
      <text class="tw-zone-label" x="${cx}" y="${(Number(cy)-Number(cry)-8).toFixed(1)}" text-anchor="middle">CLAIM ZONE</text>`;
  }

  function renderLeader(data){
    const panel=$("[data-tw-leader]");
    const intel=data.leaderIntel;
    const show=data.viewer?.mode==="leader"||data.viewer?.mode==="admin";
    panel.hidden=!show;
    if(!show||!intel)return;
    $("[data-tw-side]").textContent=String(data.viewer?.side||"spectator").toUpperCase();
    $("[data-tw-battle]").textContent=`${intel.battlefield?.friendly??0} / ${intel.battlefield?.opposing??0}`;
    $("[data-tw-claim]").textContent=`${intel.claim?.friendly??0} / ${intel.claim?.opposing??0}`;
    $("[data-tw-lineup]").textContent=String(intel.activeLineup?.friendly??0);
  }

  function renderAdmin(data){
    const panel=$("[data-tw-admin]"), list=$("[data-tw-fighters]");
    const fighters=Array.isArray(data.adminIntel?.fighters)?data.adminIntel.fighters:[];
    const show=data.viewer?.mode==="admin"; panel.hidden=!show; if(!show)return;
    $("[data-tw-fighter-count]").textContent=String(fighters.length);
    list.innerHTML=fighters.slice(0,10).map(f=>`<div class="tw-fighter" data-side="${esc(f.side)}"><div><strong>${esc(f.name)}</strong><small>${esc(f.species)} · ${esc(String(f.side).toUpperCase())}</small></div><span>${f.inClaim?"CLAIM":f.inBattlefield?"FIELD":"OUT"}</span></div>`).join("");
  }

  function render(data){
    state=data; root.hidden=!data.event; if(!data.event){shapeLayer.innerHTML="";shapeLayer.dataset.phase="idle";return;}
    root.dataset.mode=data.viewer?.mode||"player"; root.dataset.phase=data.timer?.phase||"idle";
    $("[data-tw-owner]").textContent=data.event?.owner||"—";
    $("[data-tw-challenger]").textContent=data.event?.challenger||data.attack?.attacker||"—";
    $("[data-tw-territory]").textContent=data.event?.territoryName||"—";
    $("[data-tw-phase]").textContent=String(data.timer?.label||"Territory Wars").toUpperCase();
    const owner=Math.max(0,Math.min(100,Number(data.control?.owner??100)));
    const challenger=Math.max(0,Math.min(100,Number(data.control?.challenger??0)));
    $("[data-tw-owner-pct]").textContent=`${Math.round(owner)}%`;
    $("[data-tw-challenger-pct]").textContent=`${Math.round(challenger)}%`;
    $("[data-tw-owner-bar]").style.width=`${owner}%`;
    $("[data-tw-challenger-bar]").style.width=`${challenger}%`;
    const dir=data.intel?.attackerDirection||null;
    $("[data-tw-direction]").textContent=dir||"—";
    const arrow=$("[data-tw-arrow]"); arrow.style.opacity=dir?"1":".28"; arrow.style.transform=`rotate(${rotation[dir]??0}deg)`;
    renderZones(data.zones); renderLeader(data); renderAdmin(data); renderTimer();
  }

  async function refresh(){
    try{
      const response=await fetch("/api/territory-wars/overlay-state",{headers:{Accept:"application/json"},credentials:"same-origin",cache:"no-store"});
      if(!response.ok){if(response.status===401){root.hidden=true;shapeLayer.innerHTML="";return;}throw new Error(`HTTP ${response.status}`);}
      render(await response.json());
    }catch(err){console.warn("[territory-map-overlay]",err);root.hidden=true;shapeLayer.innerHTML="";}
  }

  mountShell(); refresh(); setInterval(renderTimer,200); setInterval(refresh,2000);
})();
