(() => {
  const escapeHtml = window.HDS?.escapeHtml || ((value) => String(value ?? ""));

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
    if (state === "entombed") return "100% same-species growth reset with no matching parked DinoStorage capture";
    if (state === "dead") return "Life ended with DinoStorage checked and no matching parked capture";
    return "Storage evidence unavailable — this life has not been classified as dead";
  }

  function lifeDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : "—";
  }

  const originalRenderDinoCard = window.renderDinoCard;
  if (typeof originalRenderDinoCard === "function") {
    window.renderDinoCard = function renderDinoCardWithState(dino) {
      const html = originalRenderDinoCard(dino);
      if (String(dino?.lifecycleState || "parked") !== "parked") return html;
      return html.replace(
        "<span>Stored ",
        '<span><strong class="prime-zone-type">PARKED</strong> · '
      );
    };
  }

  const originalRenderPrimeTracker = window.renderPrimeTracker;
  if (typeof originalRenderPrimeTracker !== "function") return;

  window.renderPrimeTracker = function renderPrimeTrackerWithLifecycle(state) {
    originalRenderPrimeTracker(state);

    const panel = document.querySelector("#prime-tracker-card .prime-tracker-panel");
    const history = Array.isArray(state?.history) ? state.history : [];
    const storageAvailable = state?.storageEvidence?.available === true;
    if (!panel || !history.length) return;

    const rows = history.slice(0, 8).map((life) => {
      const label = stateLabel(life, storageAvailable);
      const growth = Math.round((Number(life?.growth) || 0) * 100);
      const ended = life?.endedAt ? `Ended ${lifeDate(life.endedAt)}` : `Seen ${lifeDate(life.lastSeenAt)}`;
      const inferred = life?.stateConfidence === "inferred" ? " · inferred" : "";
      return `
        <div class="prime-zone-row">
          <div>
            <span class="prime-zone-type">${escapeHtml(label)}</span>
            <strong>${escapeHtml(life?.species || "Unknown")} · ${growth}%</strong>
            <small>${escapeHtml(ended)}</small>
          </div>
          <div class="prime-zone-meta">
            <b>${escapeHtml(label)}</b>
            <span>${escapeHtml(stateNote(life, storageAvailable))}${escapeHtml(inferred)}</span>
          </div>
        </div>`;
    }).join("");

    const evidenceText = storageAvailable
      ? "DinoStorage evidence is available for this view."
      : "DinoStorage evidence is unavailable. Ended lives stay UNKNOWN until storage can be verified.";

    panel.insertAdjacentHTML("beforeend", `
      <div class="list-heading prime-history-heading">
        <span>DINO LIFE HISTORY</span>
        <small>Active / Parked / Entombed / Dead / Unknown</small>
      </div>
      <div class="prime-zone-history">${rows}</div>
      <div class="prime-tracker-note">
        <strong>DINO HISTORY CLASSIFICATION</strong>
        <span>${escapeHtml(evidenceText)} Parked is confirmed from DinoStorage. Entombed is inferred only when a 98.5%+ life resets into the same species.</span>
      </div>`);
  };
})();
