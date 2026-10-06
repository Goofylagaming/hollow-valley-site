(() => {
  const $ = (id) => document.getElementById(id);
  const hud = $("territoryHud");
  const DIRECTION_ROTATION = { N:0, NE:45, E:90, SE:135, S:180, SW:225, W:270, NW:315 };
  let state = null;
  let lastFetchAt = 0;

  function text(id, value) {
    const node = $(id);
    if (node) node.textContent = value == null || value === "" ? "—" : String(value);
  }

  function formatClock(ms) {
    const value = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(value / 60);
    const seconds = value % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function renderCountdown() {
    if (!state) return;
    const endsAt = state.timer?.endsAt ? new Date(state.timer.endsAt).getTime() : NaN;
    if (Number.isFinite(endsAt)) {
      text("countdown", formatClock(endsAt - Date.now()));
    } else {
      const phase = state.timer?.phase;
      text("countdown", phase === "control-live" ? "LIVE" : phase === "waiting-claim" ? "ARMED" : "--:--");
    }
  }

  function renderDirection(direction) {
    text("attackerDirection", direction || "—");
    const arrow = $("directionArrow");
    if (!arrow) return;
    const degrees = DIRECTION_ROTATION[direction];
    arrow.style.opacity = direction ? "1" : ".28";
    arrow.style.transform = `rotate(${Number.isFinite(degrees) ? degrees : 0}deg)`;
  }

  function renderRadar(zones, viewer) {
    const ring = $("claimRing");
    if (ring && zones?.claimToBattlefieldRatio) {
      const size = Math.max(12, Math.min(90, zones.claimToBattlefieldRatio * 100));
      ring.style.width = `${size}%`;
      ring.style.height = `${size}%`;
    }

    text("battlefieldRadius", zones ? `Battlefield Ø ${zones.battlefieldRadiusMetres * 2}m` : "Battlefield —");
    text("claimRadius", zones ? `Claim Ø ${zones.claimRadiusMetres * 2}m` : "Claim —");

    const dot = $("selfDot");
    const point = zones?.selfRadar;
    if (!dot || !point) {
      if (dot) dot.hidden = true;
      return;
    }
    dot.hidden = false;
    dot.style.left = `${50 + point.x * 48}%`;
    dot.style.top = `${50 + point.y * 48}%`;
    dot.style.opacity = point.outsideBattlefield ? ".55" : "1";

    const battlefield = $("battlefieldStatus");
    battlefield.textContent = viewer?.inBattlefield ? "INSIDE BATTLEFIELD" : "OUTSIDE BATTLEFIELD";
    battlefield.classList.toggle("active", Boolean(viewer?.inBattlefield));
    battlefield.classList.toggle("danger", false);

    const claim = $("claimStatus");
    const claimActive = state?.timer?.phase === "control-live";
    claim.textContent = viewer?.inClaim
      ? (claimActive ? "INSIDE ACTIVE CLAIM" : "INSIDE CLAIM ZONE")
      : (claimActive ? "CLAIM ACTIVE" : "CLAIM INACTIVE");
    claim.classList.toggle("active", Boolean(viewer?.inClaim || claimActive));
    claim.classList.toggle("danger", Boolean(viewer?.inClaim && claimActive));
  }

  function renderLeader(data) {
    const panel = $("leaderPanel");
    const intel = data.leaderIntel;
    const visible = data.viewer?.mode === "leader" || data.viewer?.mode === "admin";
    panel.hidden = !visible;
    if (!visible || !intel) return;
    text("viewerSide", String(data.viewer?.side || "spectator").toUpperCase());
    text("battlefieldCounts", `${intel.battlefield?.friendly ?? 0} / ${intel.battlefield?.opposing ?? 0}`);
    text("claimCounts", `${intel.claim?.friendly ?? 0} / ${intel.claim?.opposing ?? 0}`);
    text("lineupCount", intel.activeLineup?.friendly ?? 0);
  }

  function renderAdmin(data) {
    const panel = $("adminPanel");
    const fighters = Array.isArray(data.adminIntel?.fighters) ? data.adminIntel.fighters : [];
    const visible = data.viewer?.mode === "admin";
    panel.hidden = !visible;
    if (!visible) return;
    text("fighterCount", fighters.length);
    const list = $("fighterList");
    list.replaceChildren();
    fighters.slice(0, 12).forEach((fighter) => {
      const row = document.createElement("div");
      row.className = "fighter-row";
      row.dataset.side = fighter.side || "";
      const left = document.createElement("div");
      const name = document.createElement("strong");
      const meta = document.createElement("small");
      const zone = document.createElement("span");
      name.textContent = fighter.name || "Unknown fighter";
      meta.textContent = `${fighter.species || "Unknown"} · ${String(fighter.side || "").toUpperCase()}`;
      zone.textContent = fighter.inClaim ? "CLAIM" : fighter.inBattlefield ? "BATTLEFIELD" : "OUTSIDE";
      left.append(name, meta);
      row.append(left, zone);
      list.append(row);
    });
  }

  function render(data) {
    state = data;
    hud.dataset.mode = data.viewer?.mode || "player";
    hud.dataset.phase = data.timer?.phase || "idle";

    text("viewMode", String(data.viewer?.mode || "player").toUpperCase());
    text("ownerName", data.event?.owner || "—");
    text("challengerName", data.event?.challenger || data.attack?.attacker || "—");
    text("territoryName", data.event?.territoryName || "No active territory");
    text("phaseLabel", String(data.timer?.label || "Territory Wars").toUpperCase());

    const ownerState = data.attack ? "Defending" : data.event?.status === "live" ? "Holding territory" : data.event?.status || "Territory secure";
    const challengerState = data.attack ? String(data.attack.status || "active").replace("-", " ") : "No active attack";
    text("ownerState", ownerState);
    text("challengerState", challengerState);

    const owner = Math.max(0, Math.min(100, Number(data.control?.owner ?? 100)));
    const challenger = Math.max(0, Math.min(100, Number(data.control?.challenger ?? 0)));
    text("ownerPercent", `${Math.round(owner)}%`);
    text("challengerPercent", `${Math.round(challenger)}%`);
    $("ownerBar").style.width = `${owner}%`;
    $("challengerBar").style.width = `${challenger}%`;

    renderDirection(data.intel?.attackerDirection);
    renderRadar(data.zones, data.viewer);
    renderLeader(data);
    renderAdmin(data);
    renderCountdown();

    const connection = $("connectionState");
    connection.textContent = data.server?.online ? "LIVE FEED" : "SERVER FEED OFFLINE";
    connection.className = `connection-state ${data.server?.online ? "online" : ""}`;
  }

  async function refresh() {
    try {
      const params = new URLSearchParams(location.search);
      const requestedView = params.get("view");
      const suffix = requestedView ? `?view=${encodeURIComponent(requestedView)}` : "";
      const response = await fetch(`/api/territory-wars/overlay-state${suffix}`, {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(response.status === 401 ? "LOGIN REQUIRED" : payload.error || `HTTP ${response.status}`);
      }
      const data = await response.json();
      lastFetchAt = Date.now();
      render(data);
    } catch (error) {
      const connection = $("connectionState");
      connection.textContent = error?.message || "OVERLAY OFFLINE";
      connection.className = "connection-state error";
    }
  }

  setInterval(renderCountdown, 200);
  setInterval(() => {
    if (Date.now() - lastFetchAt > 12000) {
      const connection = $("connectionState");
      connection.textContent = "FEED STALE";
      connection.className = "connection-state error";
    }
  }, 1000);
  setInterval(refresh, 2000);
  refresh();
})();
