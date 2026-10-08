(() => {
  const root = document.getElementById("territory-war-overlay-slot");
  const shapeLayer = document.getElementById("territory-war-shapes");
  const layerToggle = document.getElementById("layer-territoryWars");
  const adminTools = document.getElementById("territory-layer-tools");
  const previewToggle = document.getElementById("territory-admin-preview");
  const previewSelect = document.getElementById("territory-preview-territory");
  const previewNote = document.getElementById("territory-preview-note");
  if (!root || !shapeLayer || !layerToggle) return;

  const LAYER_KEY = "hollow-valley-map-territory-enabled";
  const PREVIEW_KEY = "hollow-valley-map-territory-admin-preview";
  const PREVIEW_TERRITORY_KEY = "hollow-valley-map-territory-preview-name";
  const $ = (selector) => root.querySelector(selector);
  const rotation = {N:0,NE:45,E:90,SE:135,S:180,SW:225,W:270,NW:315};
  let state = null;
  let adminPreviewAvailable = false;
  let refreshInFlight = false;

  function storageGet(key, fallback = null) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function storageSet(key, value) {
    try { localStorage.setItem(key, String(value)); } catch {}
  }

  function esc(value){
    return String(value ?? "").replace(/[&<>"']/g,(ch)=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch]));
  }

  function clock(ms){
    const s=Math.max(0,Math.ceil(ms/1000));
    return `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
  }

  function layerEnabled() {
    return Boolean(layerToggle.checked);
  }

  function previewEnabled() {
    return Boolean(adminPreviewAvailable && previewToggle?.checked);
  }

  function mountShell(){
    root.innerHTML = `
      <div class="tw-preview-banner"><small>ADMIN PREVIEW</small><strong data-tw-preview-name>—</strong><span>Battlefield + Claim boundaries · read only</span></div>
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

  function syncAdminControls(data) {
    const preview = data?.preview || {};
    adminPreviewAvailable = Boolean(preview.available);

    if (adminTools) adminTools.hidden = !adminPreviewAvailable;
    if (!adminPreviewAvailable) {
      if (previewToggle) previewToggle.checked = false;
      return;
    }

    const territories = Array.isArray(preview.territories) ? preview.territories.filter(Boolean) : [];
    if (previewSelect && territories.length) {
      const currentOptions = [...previewSelect.options].map((option) => option.value);
      if (currentOptions.join("|") !== territories.join("|")) {
        previewSelect.innerHTML = territories.map((name) => {
          const label = name === "__all__" ? "ALL TERRITORIES" : name;
          return `<option value="${esc(name)}">${esc(label)}</option>`;
        }).join("");
      }

      const stored = storageGet(PREVIEW_TERRITORY_KEY, "__all__");
      const selectedValue = territories.includes(preview.territoryValue)
        ? preview.territoryValue
        : territories.includes(stored)
          ? stored
          : territories[0];
      previewSelect.value = selectedValue;
    }

    if (previewNote) {
      previewNote.textContent = preview.active
        ? "Read-only admin preview active. No Territory War event has been created or changed."
        : "Read-only boundary preview. Does not create or change a Territory War event.";
    }
  }

  function renderTimer(){
    if(!state || state.preview?.active) return;
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

  function zoneMarkup(z, { compact = false } = {}){
    if(!z?.mapCenter || !z?.battlefieldMapRadius || !z?.claimMapRadius) return "";
    const cx=(z.mapCenter.left*1000).toFixed(1), cy=(z.mapCenter.top*1000).toFixed(1);
    const brx=(z.battlefieldMapRadius.x*1000).toFixed(1), bry=(z.battlefieldMapRadius.y*1000).toFixed(1);
    const crx=(z.claimMapRadius.x*1000).toFixed(1), cry=(z.claimMapRadius.y*1000).toFixed(1);
    if(compact){
      return `
        <g class="tw-zone-group" data-territory="${esc(z.territoryName)}">
          <ellipse class="tw-zone-shape battlefield" cx="${cx}" cy="${cy}" rx="${brx}" ry="${bry}"><title>${esc(z.territoryName)} Battlefield · ${z.battlefieldRadiusMetres ?? "?"}m radius</title></ellipse>
          <ellipse class="tw-zone-shape claim" cx="${cx}" cy="${cy}" rx="${crx}" ry="${cry}"><title>${esc(z.territoryName)} Claim Zone · ${z.claimRadiusMetres ?? "?"}m radius</title></ellipse>
          <circle class="tw-zone-center" cx="${cx}" cy="${cy}" r="2.5"><title>${esc(z.territoryName)}</title></circle>
          <text class="tw-zone-label tw-territory-name" x="${cx}" y="${(Number(cy)-Number(cry)-5).toFixed(1)}" text-anchor="middle">${esc(z.territoryName)}</text>
        </g>`;
    }
    return `
      <ellipse class="tw-zone-shape battlefield" cx="${cx}" cy="${cy}" rx="${brx}" ry="${bry}"><title>${esc(z.territoryName)} Battlefield</title></ellipse>
      <ellipse class="tw-zone-shape claim" cx="${cx}" cy="${cy}" rx="${crx}" ry="${cry}"><title>${esc(z.territoryName)} Claim Zone</title></ellipse>
      <text class="tw-zone-label" x="${cx}" y="${(Number(cy)-Number(bry)-8).toFixed(1)}" text-anchor="middle">BATTLEFIELD</text>
      <text class="tw-zone-label" x="${cx}" y="${(Number(cy)-Number(cry)-8).toFixed(1)}" text-anchor="middle">CLAIM ZONE</text>`;
  }

  function renderZones(z, preview = false){
    shapeLayer.dataset.phase=preview ? "preview" : (state?.timer?.phase||"idle");
    shapeLayer.dataset.preview=preview?"true":"false";
    shapeLayer.dataset.allTerritories="false";
    const markup=zoneMarkup(z);
    shapeLayer.innerHTML=markup;
  }

  function renderAllPreviewZones(zones){
    const entries=Array.isArray(zones)?zones.filter(Boolean):[];
    shapeLayer.dataset.phase="preview";
    shapeLayer.dataset.preview="true";
    shapeLayer.dataset.allTerritories="true";
    shapeLayer.innerHTML=entries.map((zone)=>zoneMarkup(zone,{compact:true})).join("");
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

  function clearOverlay() {
    root.hidden=true;
    root.dataset.preview="false";
    shapeLayer.innerHTML="";
    shapeLayer.dataset.phase="idle";
    shapeLayer.dataset.preview="false";
  }

  function render(data){
    state=data;
    syncAdminControls(data);

    if(!layerEnabled()){
      clearOverlay();
      return;
    }

    if(data.preview?.active){
      root.hidden=false;
      root.dataset.preview="true";
      root.dataset.mode="admin";
      root.dataset.phase="preview";
      const name=$("[data-tw-preview-name]");
      if(name) name.textContent=data.preview.territoryName||data.zones?.territoryName||"Territory";
      if(data.preview.allTerritories){
        renderAllPreviewZones(data.preview.zones);
      }else{
        renderZones(data.zones,true);
      }
      return;
    }

    root.dataset.preview="false";
    if(!data.event){
      clearOverlay();
      return;
    }

    root.hidden=false;
    root.dataset.mode=data.viewer?.mode||"player";
    root.dataset.phase=data.timer?.phase||"idle";
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
    const arrow=$("[data-tw-arrow]");
    arrow.style.opacity=dir?"1":".28";
    arrow.style.transform=`rotate(${rotation[dir]??0}deg)`;

    renderZones(data.zones,false);
    renderLeader(data);
    renderAdmin(data);
    renderTimer();
  }

  function requestUrl(){
    const url=new URL("/api/territory-wars/overlay-state",window.location.origin);
    if(previewEnabled()){
      url.searchParams.set("preview","1");
      if(previewSelect?.value) url.searchParams.set("territory",previewSelect.value);
    }
    return `${url.pathname}${url.search}`;
  }

  async function refresh(){
    if(refreshInFlight) return;
    refreshInFlight=true;
    try{
      const response=await fetch(requestUrl(),{
        headers:{Accept:"application/json"},
        credentials:"same-origin",
        cache:"no-store"
      });
      if(!response.ok){
        if(response.status===401){
          adminPreviewAvailable=false;
          if(adminTools) adminTools.hidden=true;
          clearOverlay();
          return;
        }
        throw new Error(`HTTP ${response.status}`);
      }
      render(await response.json());
    }catch(err){
      console.warn("[territory-map-overlay]",err);
      clearOverlay();
    }finally{
      refreshInFlight=false;
    }
  }

  mountShell();

  layerToggle.checked=storageGet(LAYER_KEY,"1")!=="0";
  if(previewToggle) previewToggle.checked=storageGet(PREVIEW_KEY,"0")==="1";

  layerToggle.addEventListener("change",()=>{
    storageSet(LAYER_KEY,layerToggle.checked?"1":"0");
    if(!layerToggle.checked) clearOverlay();
    else refresh();
  });

  previewToggle?.addEventListener("change",()=>{
    storageSet(PREVIEW_KEY,previewToggle.checked?"1":"0");
    refresh();
  });

  previewSelect?.addEventListener("change",()=>{
    storageSet(PREVIEW_TERRITORY_KEY,previewSelect.value);
    if(previewEnabled()) refresh();
  });

  refresh();
  setInterval(renderTimer,200);
  setInterval(refresh,2000);
})();
