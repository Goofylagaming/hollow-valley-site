/* Admin-only, read-only incident timeline. Raw messages and private details are not rendered. */
(function () {
  "use strict";
  const { api, escapeHtml, loadMe } = window.HDS;
  const get = (id) => document.getElementById(id);
  const escape = (value) => escapeHtml(String(value ?? "—"));
  const stamp = (value) => {
    const at = new Date(value);
    return Number.isFinite(at.getTime()) ? at.toLocaleString("en-AU", {
      timeZone: "Australia/Brisbane", dateStyle: "medium", timeStyle: "short",
    }) : "—";
  };

  async function refresh() {
    const button = get("incident-refresh");
    button.disabled = true;
    get("incident-feedback").textContent = "Loading incident history…";
    try {
      const query = new URLSearchParams({
        q: get("incident-search").value.trim().slice(0, 120),
        source: get("incident-source").value,
        status: get("incident-status").value,
        limit: "100",
      });
      const result = await api("/api/admin-incidents/timeline?" + query);
      const items = Array.isArray(result.events) ? result.events : [];
      get("incident-records").innerHTML = items.length
        ? items.map((item) => {
          const status = ["succeeded", "completed", "failed"].includes(item.status) ? item.status : "";
          return '<tr>' +
            '<td>' + escape(stamp(item.at)) + '</td>' +
            '<td>' + escape(item.source) + '</td>' +
            '<td><strong>' + escape(item.category) + '</strong><div>' + escape(item.action) + '</div></td>' +
            '<td>' + escape(item.actorName || item.actorSteamId) + '</td>' +
            '<td>' + escape(item.playerSteamId) + '</td>' +
            '<td><span class="hv-incidents-status ' + status + '">' + escape(item.status) + '</span></td>' +
            '<td>' + escape(item.reference || item.id) + '</td>' +
            '</tr>';
        }).join("")
        : '<tr><td colspan="7" class="hv-incidents-empty">No records matched the selected filters.</td></tr>';
      const partial = Array.isArray(result.partialSources) && result.partialSources.length
        ? " · Temporarily unavailable: " + result.partialSources.join(", ") : "";
      get("incident-feedback").textContent = items.length + " recent event(s) shown" +
        (result.hasMoreUnloaded ? " · Older entries may exist" : "") + partial;
    } catch (error) {
      get("incident-records").innerHTML = '<tr><td colspan="7" class="hv-incidents-empty">Incident records could not be loaded.</td></tr>';
      get("incident-feedback").textContent = "The incident service is temporarily unavailable.";
      console.warn("[admin-incidents] timeline load failed", error.status || "request");
    } finally {
      button.disabled = false;
    }
  }

  async function init() {
    const me = await loadMe();
    const admin = me?.loggedIn && me.user?.is_admin;
    get("incident-guard").hidden = Boolean(admin);
    get("incident-content").hidden = !admin;
    if (!admin) return;
    get("incident-filters").addEventListener("submit", (event) => {
      event.preventDefault();
      refresh();
    });
    await refresh();
  }

  init().catch(() => {
    get("incident-guard").hidden = false;
    get("incident-content").hidden = true;
  });
})();
