(() => {
  const escapeHtml = window.HDS?.escapeHtml || ((value) => String(value ?? ""));

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
    if (state === "entombed") return "100% same-species growth reset with no matching parked DinoStorage capture";
    return "Life ended without a matching parked DinoStorage capture";
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
    if (!panel || !history.length) return;

    const rows = history.slice(0, 8).map((life) => {
      const label = stateLabel(life);
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
            <span>${escapeHtml(stateNote(life))}${escapeHtml(inferred)}</span>
          </div>
        </div>`;
    }).join("");

    panel.insertAdjacentHTML("beforeend", `
      <div class="list-heading prime-history-heading">
        <span>DINO LIFE HISTORY</span>
        <small>Active / Parked / Entombed / Dead</small>
      </div>
      <div class="prime-zone-history">${rows}</div>
      <div class="prime-tracker-note">
        <strong>ENTOMB DETECTION</strong>
        <span>Parked is confirmed from DinoStorage. Entombed is inferred only when a 98.5%+ life resets into the same species and no matching DinoStorage capture exists. Everything else that ended is shown as Dead.</span>
      </div>`);
  };
})();