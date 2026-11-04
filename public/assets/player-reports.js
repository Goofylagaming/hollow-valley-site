/* Private Steam-linked reports. No game moderation actions happen here. */
(function () {
  "use strict";
  const { api, loadMe, escapeHtml } = window.HDS;
  const el = (id) => document.getElementById(id);
  const esc = (value) => escapeHtml(String(value ?? ""));
  const datetime = (value) => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString("en-AU", {
      timeZone: "Australia/Brisbane", dateStyle: "medium", timeStyle: "short",
    }) + " AEST" : "Time unavailable";
  };
  function renderMine(list) {
    el("report-mine").innerHTML = list.length ? list.map(item => {
      const status = ["resolved", "dismissed", "reviewing"].includes(item.status) ? item.status : "";
      return '<article class="hv-report-item">' +
        '<div class="hv-report-heading"><h3>' + esc(item.category) + '</h3>' +
        '<span class="hv-report-status ' + status + '">' + esc(item.status) + '</span></div>' +
        '<div class="hv-report-meta">Submitted ' + esc(datetime(item.createdAt)) +
        ' · Reference ' + esc(item.id) + '</div>' +
        '<p class="hv-report-description">' + esc(item.description) + '</p>' +
        '</article>';
    }).join("") : '<p>No reports submitted yet.</p>';
  }
  async function loadMine() {
    try {
      const result = await api("/api/reports/mine");
      renderMine(Array.isArray(result.reports) ? result.reports : []);
    } catch { el("report-mine").textContent = "Your report history could not be loaded."; }
  }
  async function submit(event) {
    event.preventDefault();
    const button = el("report-submit");
    const feedback = el("report-submit-feedback");
    const time = el("report-occurred").value;
    let occurredAt = null;
    if (time) {
      const parsed = new Date(time);
      if (!Number.isFinite(parsed.getTime())) {
        feedback.textContent = "Please enter a valid incident date and time.";
        return;
      }
      occurredAt = parsed.toISOString();
    }
    const body = {
      category: el("report-category").value,
      reportedSteamId: el("report-target").value.trim(),
      occurredAt,
      description: el("report-description").value.trim(),
      evidenceUrls: Array.from(document.querySelectorAll(".report-evidence-link"))
        .map(input => input.value.trim()).filter(Boolean),
    };
    button.disabled = true;
    feedback.textContent = "Submitting your private report…";
    try {
      const result = await api("/api/reports", { method: "POST", body: JSON.stringify(body) });
      feedback.textContent = "Report received. Reference: " + result.report.id;
      el("report-form").reset();
      await loadMine();
    } catch (error) {
      feedback.textContent = error.message || "Your report could not be submitted.";
    } finally { button.disabled = false; }
  }
  async function init() {
    const [me, capabilities] = await Promise.all([
      loadMe(), api("/api/reports/capabilities").catch(() => ({ enabled:false })),
    ]);
    const signedIn = Boolean(me?.loggedIn && /^\d{17}$/.test(String(me.user?.steam_id || "")));
    el("report-signin").hidden = signedIn;
    el("report-content").hidden = !signedIn;
    el("report-disabled").hidden = !signedIn || capabilities.enabled;
    if (!signedIn) return;
    el("report-form").hidden = !capabilities.enabled;
    el("report-form").addEventListener("submit", submit);
    await loadMine();
  }
  init().catch(() => {
    el("report-signin").hidden = false;
    el("report-content").hidden = true;
  });
})();
