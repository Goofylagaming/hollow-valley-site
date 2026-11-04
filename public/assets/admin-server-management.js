"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const api = window.HDS?.api;
  const order = [
    "watchdog", "scheduled_restart", "autosave", "scanner",
    "command_bridge", "combat_forwarder", "legacy_combat_forwarder",
  ];
  let refreshing = false;

  function put(id, value) {
    if ($(id)) $(id).textContent = value == null || value === "" ? "—" : String(value);
  }
  function when(iso) {
    if (!iso || Number.isNaN(Date.parse(iso))) return "—";
    return new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Brisbane", dateStyle: "short", timeStyle: "short",
    }).format(new Date(iso)) + " QLD";
  }
  function cell(text) {
    const td = document.createElement("td");
    td.textContent = String(text == null ? "—" : text);
    return td;
  }
  function showError(message) {
    const el = $("hv-management-error");
    el.textContent = String(message || "Could not retrieve the management status.");
    el.hidden = false;
  }

  async function enableStart(key) {
    const phrase = "ENABLE " + key;
    const entered = window.prompt(
      "This requests Windows Task Scheduler to enable and start " + key +
      " on BinaryLane. It will NOT restart The Isle.\n\nType exactly: " + phrase
    );
    if (entered === null) return;
    if (entered !== phrase) {
      showError("Confirmation did not match. No change requested.");
      return;
    }
    try {
      const response = await api("/api/admin/server-management/jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-HV-Owner-Action": "enable-start-v1",
        },
        body: JSON.stringify({ action: "enable_start", target: key, confirmation: phrase }),
      });
      put("hv-management-connection", "Queued " + key + " · " + response.job.state);
      await refresh();
    } catch (e) {
      showError(e.message);
    }
  }

  function renderTasks(data) {
    const tbody = $("hv-management-task-rows");
    tbody.replaceChildren();
    const tasks = data.snapshot?.tasks || {};
    for (const key of order) {
      const tr = document.createElement("tr");
      tr.append(cell(data.taskNames?.[key] || key), cell(data.connected ? tasks[key] : "Unverified"));
      const action = document.createElement("td");
      const canWrite = data.writesEnabled && data.connected &&
        data.writableTargets?.includes(key) &&
        data.snapshot?.server?.processCount === 1 &&
        !(key === "combat_forwarder" &&
          !["Disabled", "Missing"].includes(tasks.legacy_combat_forwarder));
      if (data.writableTargets?.includes(key)) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "small-button";
        btn.textContent = "Enable & Start";
        btn.disabled = !canWrite || tasks[key] === "Running";
        btn.addEventListener("click", () => enableStart(key));
        action.append(btn);
      } else {
        action.textContent = "Read only";
      }
      tr.append(action);
      tbody.append(tr);
    }
  }

  function renderJobs(jobs) {
    const tbody = $("hv-management-job-rows");
    tbody.replaceChildren();
    if (!jobs?.length) {
      const tr = document.createElement("tr");
      const td = cell("No management requests recorded.");
      td.colSpan = 3;
      tr.append(td);
      tbody.append(tr);
      return;
    }
    for (const job of jobs) {
      const tr = document.createElement("tr");
      tr.append(
        cell(when(job.createdAt)),
        cell(job.target + " · " + job.action),
        cell(job.state + (job.result ? " — " + job.result : ""))
      );
      tbody.append(tr);
    }
  }

  function render(data) {
    const health = data.snapshot?.server || {};
    put("hv-management-connection",
      !data.featureEnabled ? "Feature disabled on website"
        : !data.agentConfigured ? "Dedicated agent token not configured"
          : data.connected ? "BinaryLane agent connected" : "BinaryLane agent offline / stale");
    put("hv-management-updated", "Last heartbeat: " + when(data.receivedAt));
    put("hv-management-pid", data.connected ? (health.pid || "No process") : "Unverified");
    put("hv-management-processes", "Process count: " + (data.connected ? health.processCount ?? "—" : "—"));
    put("hv-management-rcon", !data.connected ? "Unverified" : health.rconOwnedByGame ? "Listening" : "Not verified");
    put("hv-management-writes", data.writesEnabled ? "Approved tasks" : "Locked");
    renderTasks(data);
    renderJobs(data.jobs);
    for (const key of ["restart", "forwarder", "bridge"]) {
      const lines = data.snapshot?.logs?.[key];
      put("hv-management-log-" + key, Array.isArray(lines) && lines.length ? lines.join("\n") : "No entries available.");
    }
  }
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    $("hv-management-refresh").disabled = true;
    $("hv-management-error").hidden = true;
    try {
      render(await api("/api/admin/server-management", { cache: "no-store" }));
    } catch (e) {
      showError(e.message);
      put("hv-management-connection", "Management status unavailable");
    } finally {
      refreshing = false;
      $("hv-management-refresh").disabled = false;
    }
  }

  $("hv-management-refresh")?.addEventListener("click", refresh);
  refresh();
  window.setInterval(() => {
    if (document.visibilityState === "visible") refresh();
  }, 30000);
})();
