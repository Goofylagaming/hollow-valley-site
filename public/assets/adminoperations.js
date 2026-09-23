const { api, escapeHtml } = window.HDS;

let globalBodyDropState = null;
let globalBodyDropRefreshTimer = null;

function text(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? "—";
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = n;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function statePill(label, ready) {
  return `<div class="ops-check ${ready ? "ready" : "attention"}"><span class="status-dot"></span><div><b>${escapeHtml(label)}</b><small>${ready ? "Ready" : "Attention"}</small></div></div>`;
}

function readinessRow(item) {
  return `<div class="ops-readiness-row ${item.ready ? "ready" : "attention"}">
    <span class="status-dot"></span>
    <div><b>${escapeHtml(item.label || item.id || "Check")}</b><small>${escapeHtml(item.detail || "")}</small></div>
    <em>${escapeHtml(item.level || "")}</em>
  </div>`;
}

function emptyRow(cols, message) {
  return `<tr><td colspan="${cols}" class="ops-empty">${escapeHtml(message)}</td></tr>`;
}

function render(data) {
  const status = data.status || {};
  const server = status.server || {};
  const bridge = status.bridge || {};
  const requestsSummary = status.requests || {};
  const readiness = data.readiness?.readiness || {};
  const backup = data.backups?.backups || {};
  const health = data.health?.analytics || {};
  const presence = data.presence || {};

  text("ops-automation", status.ok ? "Connected" : "Unavailable");
  text("ops-automation-detail", status.time ? `Checked ${formatDate(status.time)}` : "No response");

  text("ops-server", server.online ? "Online" : server.configured ? "Offline" : "Not configured");
  text("ops-server-detail", server.online
    ? `${Number(server.playerCount || 0)}/${server.maxPlayers ?? "?"} players`
    : server.error || "Offline is expected during maintenance");

  text("ops-bridge", bridge.publisherReady ? "Ready" : "Locked");
  text("ops-bridge-detail", bridge.publisherAckRequired ? "Sole-publisher acknowledgement required" : bridge.error || "Safe state");

  text("ops-pending", String(Number(requestsSummary.pending || 0)));
  text("ops-request-detail", `${Number(requestsSummary.failed || 0)} failed · ${Number(requestsSummary.unknown || 0)} unknown`);

  text("ops-migration", String(readiness.stage || "unknown").replaceAll("-", " "));
  text("ops-migration-detail", readiness.readyForIsolatedDeployment ? "Isolated deployment ready" : "Review checks below");

  text("ops-backups", String(Number(backup.count || 0)));
  text("ops-backup-detail", backup.latest
    ? `Latest ${formatDate(backup.latest.modifiedAt)} · ${formatBytes(backup.latest.size)}`
    : backup.configured ? "No snapshots yet" : "Persistent DB not configured");

  const presenceSummary = presence.summary || status.playerPresence || {};
  const activeSessions = Array.isArray(presence.sessions) ? presence.sessions.length : Number(presenceSummary.activeSessions || 0);
  text("ops-presence", String(activeSessions));
  text("ops-presence-detail", presenceSummary.enabled === false ? "Tracking disabled" : "Currently tracked sessions");

  text("ops-availability", health.availabilityPercent == null ? "No data" : `${health.availabilityPercent}%`);
  text("ops-health-detail", `${Number(health.samples || 0)} samples · ${Number(health.outageTransitions || 0)} outage transitions`);

  const integrations = status.integrations || {};
  document.getElementById("ops-integrations").innerHTML = [
    ["BinaryLane presence feed", integrations.externalPresence],
    ["CommandBridge", integrations.commandBridge],
    ["Discord / HerbyBot", integrations.herbyBot ?? integrations.discord],
    ["Automation database", integrations.database],
  ].map(([label, ready]) => statePill(label, Boolean(ready))).join("");

  const checks = Array.isArray(readiness.checks) ? readiness.checks : [];
  text("ops-readiness-count", `${Number(readiness.requiredReady || 0)}/${Number(readiness.requiredTotal || 0)} required ready`);
  document.getElementById("ops-readiness").innerHTML = checks.length
    ? checks.map(readinessRow).join("")
    : '<div class="ops-empty-block">No migration readiness data.</div>';

  const requests = Array.isArray(data.requests?.requests) ? data.requests.requests : [];
  document.getElementById("ops-requests").innerHTML = requests.length
    ? requests.slice(0, 15).map((item) => `<tr><td>${escapeHtml(item.kind || "—")}</td><td><span class="ops-status-label ${escapeHtml(item.status || "")}">${escapeHtml(item.status || "—")}</span></td><td>${escapeHtml(formatDate(item.updated_at || item.updatedAt || item.created_at))}</td></tr>`).join("")
    : emptyRow(3, "No recent automation requests.");

  const audit = Array.isArray(data.audit?.audit) ? data.audit.audit : [];
  document.getElementById("ops-audit").innerHTML = audit.length
    ? audit.slice(0, 15).map((item) => `<tr><td>${escapeHtml(item.category || "—")}</td><td>${escapeHtml(item.action || "—")}</td><td>${escapeHtml(formatDate(item.created_at || item.createdAt))}</td></tr>`).join("")
    : emptyRow(3, "No recent audit events.");

  const backupButton = document.getElementById("ops-create-backup");
  if (backupButton) {
    backupButton.disabled = backup.configured === false;
    backupButton.title = backup.configured === false ? "A persistent automation database is required." : "";
  }
}

function renderGlobalBodyDrop(payload) {
  const state = payload?.globalBodyDrop || {};
  globalBodyDropState = state;

  const toggle = document.getElementById("ops-global-bodydrop-toggle");
  const activate = document.getElementById("ops-global-bodydrop-activate");
  const message = document.getElementById("ops-global-bodydrop-message");
  const lastRun = state.lastRun || null;

  if (toggle) {
    toggle.disabled = Boolean(state.running);
    toggle.textContent = state.enabled ? "Turn Global Drop OFF" : "Turn Global Drop ON";
  }
  if (activate) {
    activate.disabled = !state.enabled || Boolean(state.running);
  }

  if (message) {
    if (state.running) {
      message.textContent = `Running · ${Number(lastRun?.completedCount || 0)}/${Number(lastRun?.scheduledCount || 0)} processed · ${Number(lastRun?.queuedCount || 0)} queued`;
    } else if (state.enabled) {
      message.textContent = "ARMED for one activation · small bodies only · tool auto-disables after activation.";
    } else if (lastRun) {
      message.textContent = `OFF · last run: ${Number(lastRun.scheduledCount || 0)} scheduled · ${Number(lastRun.queuedCount || 0)} queued · ${Number(lastRun.skippedCount || 0)} skipped · ${Number(lastRun.failedCount || 0)} failed`;
    } else {
      message.textContent = "OFF by default. Enable it to arm one emergency global run.";
    }
  }

  clearTimeout(globalBodyDropRefreshTimer);
  if (state.running) {
    globalBodyDropRefreshTimer = setTimeout(loadGlobalBodyDrop, 2000);
  }
}

async function loadGlobalBodyDrop() {
  try {
    renderGlobalBodyDrop(await api("/api/admin-operations/bodydrop-global"));
  } catch (error) {
    const message = document.getElementById("ops-global-bodydrop-message");
    const toggle = document.getElementById("ops-global-bodydrop-toggle");
    const activate = document.getElementById("ops-global-bodydrop-activate");
    if (message) message.textContent = error.message || "Global BodyDrop controls unavailable.";
    if (toggle) toggle.disabled = true;
    if (activate) activate.disabled = true;
  }
}

async function loadOperations({ force = false } = {}) {
  const message = document.getElementById("ops-message");
  const refresh = document.getElementById("ops-refresh");
  if (refresh) refresh.disabled = true;
  if (message) message.textContent = force ? "Refreshing…" : "Loading…";

  try {
    const data = await api(`/api/admin-operations${force ? "?force=1" : ""}`);
    render(data);
    if (message) message.textContent = "Up to date";
  } catch (error) {
    if (message) message.textContent = error.message || "Operations data unavailable";
  } finally {
    if (refresh) refresh.disabled = false;
  }
}

document.getElementById("ops-refresh")?.addEventListener("click", () => {
  loadOperations({ force: true });
  loadGlobalBodyDrop();
});

document.getElementById("ops-global-bodydrop-toggle")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const message = document.getElementById("ops-global-bodydrop-message");
  const enabled = !globalBodyDropState?.enabled;
  button.disabled = true;
  if (message) message.textContent = enabled ? "Arming global emergency BodyDrop…" : "Turning global emergency BodyDrop off…";
  try {
    const result = await api("/api/admin-operations/bodydrop-global/toggle", {
      method: "POST",
      body: JSON.stringify({ enabled }),
    });
    renderGlobalBodyDrop(result);
  } catch (error) {
    if (message) message.textContent = error.message || "Could not change global BodyDrop state.";
    await loadGlobalBodyDrop();
  }
});

document.getElementById("ops-global-bodydrop-activate")?.addEventListener("click", async (event) => {
  if (!window.confirm(
    "Activate ONE global emergency BodyDrop run now?\n\n" +
    "Eligible targets: spawned carnivores at 60% growth or below AND 30% food or below. " +
    "Small bodies are staggered between players and normal per-player cooldowns are respected. " +
    "The global tool will switch OFF immediately after activation."
  )) return;

  const button = event.currentTarget;
  const message = document.getElementById("ops-global-bodydrop-message");
  button.disabled = true;
  button.textContent = "Activating…";
  if (message) message.textContent = "Scanning live players and scheduling eligible drops…";
  try {
    const result = await api("/api/admin-operations/bodydrop-global/activate", { method: "POST" });
    renderGlobalBodyDrop(result);
  } catch (error) {
    if (message) message.textContent = error.message || "Global BodyDrop activation failed.";
    await loadGlobalBodyDrop();
  } finally {
    button.textContent = "Activate Global Drop →";
  }
});

document.getElementById("ops-create-backup")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const message = document.getElementById("ops-message");
  button.disabled = true;
  button.textContent = "Creating…";
  if (message) message.textContent = "Creating database snapshot…";
  try {
    const result = await api("/api/admin-operations/backup", { method: "POST" });
    const backup = result.backup || {};
    if (message) message.textContent = backup.skipped
      ? `Backup skipped: ${backup.reason || "already running"}`
      : `Backup created: ${backup.fileName || "snapshot"}`;
    await loadOperations();
  } catch (error) {
    if (message) message.textContent = error.message || "Backup failed";
  } finally {
    button.textContent = "Create backup";
    button.disabled = false;
  }
});

async function init() {
  const me = await window.HDS.loadMe();
  const guard = document.getElementById("ops-guard");
  const content = document.getElementById("ops-content");

  if (!me.loggedIn || !me.user?.is_admin) {
    guard.hidden = false;
    guard.innerHTML = '<p class="section-intro">Admin access is required.</p>';
    content.hidden = true;
    return;
  }

  guard.hidden = true;
  content.hidden = false;
  await Promise.all([loadOperations(), loadGlobalBodyDrop()]);
}

init();
