const { api, escapeHtml } = window.HDS;

function stateLabel(life) {
  const state = String(life?.lifecycleState || "dead").toLowerCase();
  if (state === "active") return "ACTIVE";
  if (state === "parked") return "PARKED";
  if (state === "entombed") return "ENTOMBED";
  return "DEAD";
}

function stateNote(life) {
  const state = String(life?.lifecycleState || "dead").toLowerCase();
  if (state === "active") return "Current tracked in-game life";
  if (state === "parked") return life?.parkedSlot
    ? `Matched DinoStorage slot ${life.parkedSlot}`
    : "Matched a Hollow Valley DinoStorage capture";
  if (state === "entombed") return "Near-100% same-species reset with no matching parked DinoStorage capture";
  return "Life ended without a matching parked DinoStorage capture";
}

function lifeDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "—";
}

function growthPercent(value) {
  const growth = Number(value);
  if (!Number.isFinite(growth)) return 0;
  return Math.max(0, Math.min(100, Math.round(growth <= 1 ? growth * 100 : growth)));
}

function countStates(history, supplied) {
  if (supplied && typeof supplied === "object") return supplied;
  const counts = { active: 0, parked: 0, entombed: 0, dead: 0 };
  for (const life of history) {
    const state = String(life?.lifecycleState || "dead").toLowerCase();
    if (Object.prototype.hasOwnProperty.call(counts, state)) counts[state] += 1;
    else counts.dead += 1;
  }
  return counts;
}

function renderHistory(state) {
  const card = document.getElementById("dinohistory-card");
  if (!card) return;

  const history = Array.isArray(state?.history) ? state.history : [];
  const counts = countStates(history, state?.lifecycleStates);

  if (!history.length) {
    card.innerHTML = `
      <div class="prime-tracker-heading">
        <div><p class="overline green">DINO LIFE HISTORY</p><h3>No tracked dino lives yet.</h3></div>
        <span class="tag-pill">READY</span>
      </div>
      <p class="section-intro">Spawn in-game and verified presence tracking will begin building your dinosaur history.</p>`;
    return;
  }

  const rows = history.slice(0, 30).map((life) => {
    const label = stateLabel(life);
    const ended = life?.endedAt ? `Ended ${lifeDate(life.endedAt)}` : `Seen ${lifeDate(life.lastSeenAt)}`;
    const inferred = life?.stateConfidence === "inferred" ? " · inferred" : "";
    return `
      <div class="prime-zone-row">
        <div>
          <span class="prime-zone-type">${escapeHtml(label)}</span>
          <strong>${escapeHtml(life?.species || "Unknown")} · ${growthPercent(life?.growth)}%</strong>
          <small>${escapeHtml(ended)}</small>
        </div>
        <div class="prime-zone-meta">
          <b>${escapeHtml(label)}</b>
          <span>${escapeHtml(stateNote(life))}${escapeHtml(inferred)}</span>
        </div>
      </div>`;
  }).join("");

  card.innerHTML = `
    <div class="prime-tracker-heading">
      <div>
        <p class="overline green">DINO LIFE HISTORY</p>
        <h3>${history.length} tracked ${history.length === 1 ? "life" : "lives"}</h3>
      </div>
      <span class="tag-pill">HISTORY</span>
    </div>

    <div class="prime-tracker-stats">
      <div><small>ACTIVE</small><b>${Number(counts.active || 0)}</b><span>Current tracked life</span></div>
      <div><small>PARKED</small><b>${Number(counts.parked || 0)}</b><span>Matched DinoStorage capture</span></div>
      <div><small>ENTOMBED</small><b>${Number(counts.entombed || 0)}</b><span>Detected continuation reset</span></div>
      <div><small>DEAD</small><b>${Number(counts.dead || 0)}</b><span>Other ended lives</span></div>
    </div>

    <div class="list-heading prime-history-heading">
      <span>RECENT DINO LIVES</span>
      <small>Newest first</small>
    </div>
    <div class="prime-zone-history">${rows}</div>

    <div class="prime-tracker-note">
      <strong>ENTOMB DETECTION</strong>
      <span>Parked is confirmed from DinoStorage. Entombed remains an inference when a near-100% life resets into the same species without a matching parked capture.</span>
    </div>`;
}

async function init() {
  const me = await window.HDS.loadMe();
  const guard = document.getElementById("dinohistory-guard");
  const content = document.getElementById("dinohistory-content");

  if (!me.loggedIn) {
    guard.hidden = false;
    content.hidden = true;
    return;
  }

  guard.hidden = true;
  content.hidden = false;

  try {
    renderHistory(await api("/api/mydinos/prime-tracker"));
  } catch (error) {
    document.getElementById("dinohistory-card").innerHTML = `
      <div class="prime-tracker-heading">
        <div><p class="overline green">DINO LIFE HISTORY</p><h3>History unavailable.</h3></div>
      </div>
      <p class="section-intro">${escapeHtml(error.message || "Could not load tracked dinosaur history.")}</p>`;
  }
}

init();
