/* Admin-only moderation. All content is escaped before insertion. */
(function () {
  "use strict";
  const { api, loadMe, escapeHtml } = window.HDS;
  const get = (id) => document.getElementById(id);
  const esc = (value) => escapeHtml(String(value ?? "—"));
  const displayTime = (value) => {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.toLocaleString("en-AU", {
      timeZone: "Australia/Brisbane", dateStyle: "medium", timeStyle: "short",
    }) + " AEST" : "—";
  };
  function render(list) {
    get("admin-report-list").innerHTML = list.length ? list.map(item => {
      const safeStatus = ["open", "reviewing", "resolved", "dismissed"].includes(item.status) ? item.status : "open";
      const evidence = Array.isArray(item.evidenceUrls) ? item.evidenceUrls : [];
      const links = evidence.map((url, index) =>
        '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">Evidence ' + (index + 1) + '</a>'
      ).join(" ");
      return '<article class="hv-report-item" data-report-id="' + esc(item.id) + '">' +
        '<div class="hv-report-heading"><h3>' + esc(item.category) + '</h3>' +
        '<span class="hv-report-status ' + safeStatus + '">' + esc(item.status) + '</span></div>' +
        '<p class="hv-report-meta">Submitted ' + esc(displayTime(item.createdAt)) +
        ' · Reporter ' + esc(item.reporterName) + ' (' + esc(item.reporterSteamId) + ')' +
        (item.reportedSteamId ? ' · Reported player ' + esc(item.reportedSteamId) : '') +
        ' · Reference ' + esc(item.id) + '</p>' +
        '<p class="hv-report-description">' + esc(item.description) + '</p>' +
        (evidence.length ? '<div class="hv-report-evidence">' + links + '</div>' : '') +
        '<div class="hv-reports-review"><label>Review status<select class="report-review-status">' +
          ["open", "reviewing", "resolved", "dismissed"].map(s =>
            '<option value="' + s + '"' + (s === safeStatus ? ' selected' : '') + '>' + s + '</option>'
          ).join("") + '</select></label>' +
        '<label>Internal note (optional)<input class="report-review-note" type="text" maxlength="500" placeholder="Admin-only review reason"></label>' +
        '<button class="report-review-save" type="button">Save review</button></div>' +
        '<small class="report-review-feedback" aria-live="polite"></small>' +
        '</article>';
    }).join("") : '<p>No reports match the selected filters.</p>';
  }
  async function load() {
    get("admin-report-feedback").textContent = "Loading private reports…";
    try {
      const query = new URLSearchParams({
        status: get("admin-report-status").value,
        q: get("admin-report-search").value.trim().slice(0, 90),
        limit: "100",
      });
      const response = await api("/api/reports/admin?" + query);
      const items = Array.isArray(response.reports) ? response.reports : [];
      render(items);
      get("admin-report-feedback").textContent = items.length + " report(s) in the current view.";
    } catch {
      get("admin-report-list").textContent = "Reports are unavailable.";
      get("admin-report-feedback").textContent = "The report queue could not be loaded.";
    }
  }
  async function review(button) {
    const item = button.closest("[data-report-id]");
    if (!item) return;
    const id = item.dataset.reportId;
    const status = item.querySelector(".report-review-status").value;
    const note = item.querySelector(".report-review-note").value.trim();
    const feedback = item.querySelector(".report-review-feedback");
    button.disabled = true;
    feedback.textContent = "Saving…";
    try {
      const result = await api("/api/reports/admin/" + encodeURIComponent(id) + "/review", {
        method: "POST", body: JSON.stringify({ status, note }),
      });
      await load();
      get("admin-report-feedback").textContent = result.changed
        ? "Review saved to admin history."
        : "No change required.";
    } catch (error) {
      feedback.textContent = error.message || "Could not save the review.";
    } finally { button.disabled = false; }
  }
  async function init() {
    const me = await loadMe();
    const admin = Boolean(me?.loggedIn && me?.user?.is_admin);
    get("admin-report-guard").hidden = admin;
    get("admin-report-content").hidden = !admin;
    if (!admin) return;
    get("admin-report-filters").addEventListener("submit", e => {e.preventDefault(); load();});
    get("admin-report-list").addEventListener("click", event => {
      const button = event.target.closest(".report-review-save");
      if (button) review(button);
    });
    await load();
  }
  init().catch(() => {
    get("admin-report-guard").hidden = false;
    get("admin-report-content").hidden = true;
  });
})();
