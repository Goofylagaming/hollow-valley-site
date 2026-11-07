(() => {
  "use strict";
  const endpoint = "/api/admin/server-management/growth";
  const storageKey = "hv-persistent-growth-request-v1";
  let state = null, busy = false, pending = null;
  const element = (id) => document.getElementById(`ops-persistent-growth-${id}`);
  function remember(value) {
    // Persist identity before sending: reloading after an uncertain response cannot duplicate a write.
    if (value) localStorage.setItem(storageKey, JSON.stringify(value));
    else localStorage.removeItem(storageKey);
    pending = value;
  }
  function render() {
    const g = state?.growth;
    element("current").textContent = !state?.connected ? "Game server status is unavailable or stale." :
      `Saved setting: ${g?.configuredMultiplier == null ? "not explicitly configured" : `${g.configuredMultiplier}×`}. ` +
      ({ pending_restart: "Awaiting scheduled restart.", restart_observed: "A subsequent restart was observed; verify gameplay.",
        needs_inspection: "Host inspection required.", unverified: "Running gameplay rate unverified." }[g?.state] || "Agent update required.");
    const job = state?.latestJob;
    const jobText = job ? ` Last request: ${job.multiplier}× — ${job.state}. ${job.message || ""}` : "";
    element("message").textContent = pending ? "A response was not confirmed. Retry the same request to check it safely; do not submit another change." :
      (state?.reason || g?.message || "Ready to save a setting for the next scheduled restart.") + jobText;
    element("save").disabled = busy || (!pending && !state?.canWrite);
    element("save").textContent = pending ? "Check / retry same request" : "Save for next restart";
    element("value").disabled = busy || Boolean(pending);
  }
  async function refresh() {
    try {
      state = await window.HDS.api(endpoint);
      if (pending && state.latestJob?.requestId === pending.requestId) remember(null);
      render();
    } catch (error) {
      state = null;
      render();
      element("message").textContent = error.message || "Could not read growth status.";
    }
  }
  async function save() {
    if (busy || (!pending && !state?.canWrite)) return;
    if (!pending) {
      const multiplier = Number(element("value").value);
      const confirmation = `SAVE ${multiplier}X GROWTH`;
      if (window.prompt(`Save ${multiplier}× growth for the next scheduled restart?\n\nThis keeps a backup and verifies the saved file. It does not change the running game immediately or restart it now.\n\nType ${confirmation}:`, "") !== confirmation) return;
      try { remember({ multiplier, expectedHash: state.growth.configHash, requestId: crypto.randomUUID(), confirmation }); }
      catch (_) { element("message").textContent = "Browser storage is unavailable. Enable it before submitting this change."; return; }
    }
    busy = true; render();
    let errorText = null;
    try {
      await window.HDS.api(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "X-HV-Owner-Action": "growth-config-v1" }, body: JSON.stringify(pending) });
      remember(null);
    } catch (error) {
      errorText = error.message || "Request status is uncertain.";
      // Explicit validation/access rejection means this request was not queued.
      if ([400, 401, 403, 404, 409].includes(error.status)) remember(null);
    }
    finally { busy = false; await refresh(); }
    if (errorText) element("message").textContent = errorText + (pending ? " Your request identity is retained for a safe retry. Refresh status before retrying." : " Refresh and review before submitting again.");
  }
  window.HVPersistentGrowth = { async init() {
    document.getElementById("persistent-growth-controls").hidden = false;
    try { pending = JSON.parse(localStorage.getItem(storageKey) || "null"); } catch (_) { pending = null; }
    element("save").addEventListener("click", save);
    element("refresh").addEventListener("click", refresh);
    await refresh();
    setInterval(() => { if (!busy && !document.hidden) refresh(); }, 15000);
  } };
})();
