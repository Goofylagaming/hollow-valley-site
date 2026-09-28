const { api, escapeHtml } = window.HDS;

function normalizedState(life, storageAvailable) {
  const state = String(life?.lifecycleState || "unknown").toLowerCase();
  if (["active", "parked", "entombed"].includes(state)) return state;
  if (state === "dead" && storageAvailable) return "dead";
  return "unknown";
}

function stateLabel(life, storageAvailable) {
  const state = normalizedState(life, storageAvailable);
  if (state === "active") return "ACTIVE";
  if (state === "parked") return "PARKED";
  if (state === "entombed") return "ENTOMBED";
  if (state === "dead") return "DEAD";
  return "UNKNOWN";
}

function stateNote(life, storageAvailable) {
  const state = normalizedState(life, storageAvailable);
  if (state === "active") return "Current tracked in-game life";
  if (state === "parked") return life?.parkedSlot
    ? `Matched DinoStorage slot ${life.parkedSlot}`
    : "Matched a Hollow Valley DinoStorage capture";
  if (state === "entombed") return "Near-100% same-species reset with no matching parked DinoStorage capture";
  if (state === "dead") return "Life ended with DinoStorage checked and no matching parked capture";
  return "Storage evidence unavailable — this life has not been classified as dead";
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

function countStates(history, storageAvailable) {
  const counts = { active: 0, parked: 0, entombed: 0, dead: 0, unknown: 0 };
  for (const life of history) {
    const state = normalizedState(life, storageAvailable);
    if (Object.prototype.hasOwnProperty.call(counts, state)) counts[state] += 1;
    else counts.unknown += 1;
  }
  return counts;
}

function renderHistory(state) {
  const card = document.getElementById("dinohistory-card");
  if (!card) return;

  const history = Array.isArray(state?.history) ? state.history : [];
  const storageAvailable = state?.storageEvidence?.available === true;
  const counts = countStates(history, storageAvailable);

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
    const label = stateLabel(life, storageAvailable);
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
          <span>${escapeHtml(stateNote(life, storageAvailable))}${escapeHtml(inferred)}</span>
        </div>
      </div>`;
  }).join("");

  const evidenceNote = storageAvailable
    ? "DinoStorage evidence loaded for this view."
    : "DinoStorage could not be verified for this view. Ended lives remain UNKNOWN rather than being incorrectly marked DEAD.";

  card.innerHTML = `
    <div class="prime-tracker-heading">
      <div>
        <p class="overline green">DINO LIFE HISTORY</p>
        <h3>${history.length} tracked ${history.length === 1 ? "life" : "lives"}</h3>
      </div>
      <span class="tag-pill">HISTORY</span>
    </div>

    <div class="prime-tracker-stats">
      <div><small>ACTIVE</small><b>${counts.active}</b><span>Current tracked life</span></div>
      <div><small>PARKED</small><b>${counts.parked}</b><span>Matched DinoStorage capture</span></div>
      <div><small>ENTOMBED</small><b>${counts.entombed}</b><span>Detected continuation reset</span></div>
      <div><small>DEAD</small><b>${counts.dead}</b><span>Storage checked, no parked match</span></div>
      <div><small>UNKNOWN</small><b>${counts.unknown}</b><span>Awaiting reliable storage evidence</span></div>
    </div>

    <div class="list-heading prime-history-heading">
      <span>RECENT DINO LIVES</span>
      <small>Newest first</small>
    </div>
    <div class="prime-zone-history">${rows}</div>

    <div class="prime-tracker-note">
      <strong>DINO HISTORY CLASSIFICATION</strong>
      <span>${escapeHtml(evidenceNote)} Parked is confirmed from DinoStorage. Entombed remains an inference when a near-100% life resets into the same species.</span>
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

  // Load DinoStorage first so lifecycle classification has authoritative parking evidence.
  // If storage fails, history still loads, but ended lives remain UNKNOWN rather than DEAD.
  try {
    await api("/api/mydinos");
  } catch (error) {
    console.warn("DinoStorage evidence unavailable for history", error);
  }

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
