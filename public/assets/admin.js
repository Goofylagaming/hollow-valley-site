const { api } = window.HDS;

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? "—";
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function renderOperations(data) {
  const status = data?.status || {};
  const server = status.server || {};
  const backups = data?.backups?.backups || {};

  setText("hub-automation", status.ok ? "Healthy" : "Attention");
  setText("hub-automation-detail", status.time ? `Checked ${formatDate(status.time)}` : "No current status");

  setText("hub-server", server.online ? "Online" : server.configured ? "Offline" : "Not configured");
  setText("hub-server-detail", server.online
    ? `${Number(server.playerCount || 0)}/${server.maxPlayers ?? "?"} online`
    : "Offline does not stop portal administration");

  setText("hub-backups", backups.configured === false ? "Not configured" : `${Number(backups.count || 0)} snapshots`);
  setText("hub-backup-detail", backups.latest?.modifiedAt ? `Latest ${formatDate(backups.latest.modifiedAt)}` : "No recent snapshot");
}

function renderComms(data) {
  const discord = data?.discord || {};
  setText("hub-herbybot", discord.configured ? "Connected" : "Not configured");
  setText("hub-herbybot-detail", discord.deliveryMode || "Automation bridge");
}

function renderEventRewards(data) {
  const state = data?.state || {};
  const rewards = Array.isArray(data?.rewards) ? data.rewards : [];
  setText("hub-event-rewards", state.enabled ? "Enabled" : "Locked");
  setText("hub-event-detail", `${rewards.length} recent payout${rewards.length === 1 ? "" : "s"}`);
}

function renderRestore(data) {
  const state = data?.adminRestore || {};
  const ready = Boolean(state.builderReady);
  const writable = Boolean(state.writeEnabled && state.ftpConfigured);
  setText("hub-restore", writable ? "Write enabled" : ready ? "Builder ready" : "Unavailable");
  setText("hub-restore-detail", writable ? "Guarded upload is enabled" : "Writes remain locked");
}

async function loadHub() {
  const refresh = document.getElementById("admin-hub-refresh");
  const updated = document.getElementById("admin-hub-updated");
  if (refresh) refresh.disabled = true;
  if (updated) updated.textContent = "Refreshing…";

  const results = await Promise.allSettled([
    api("/api/admin-operations"),
    api("/api/admin-comms"),
    api("/api/events/admin/rewards?limit=25"),
    api("/api/admin-restore"),
  ]);

  if (results[0].status === "fulfilled") renderOperations(results[0].value);
  else {
    setText("hub-automation", "Unavailable");
    setText("hub-server", "Unknown");
    setText("hub-backups", "Unknown");
  }

  if (results[1].status === "fulfilled") renderComms(results[1].value);
  else setText("hub-herbybot", "Unavailable");

  if (results[2].status === "fulfilled") renderEventRewards(results[2].value);
  else setText("hub-event-rewards", "Unavailable");

  if (results[3].status === "fulfilled") renderRestore(results[3].value);
  else setText("hub-restore", "Unavailable");

  if (updated) updated.textContent = `Updated ${new Date().toLocaleTimeString()}`;
  if (refresh) refresh.disabled = false;
}

document.getElementById("admin-hub-refresh")?.addEventListener("click", loadHub);

async function init() {
  const me = await window.HDS.loadMe();
  const guard = document.getElementById("admin-hub-guard");
  const content = document.getElementById("admin-hub-content");

  if (!me.loggedIn || !me.user?.is_admin) {
    guard.hidden = false;
    guard.innerHTML = '<p class="section-intro">Admin access is required.</p>';
    content.hidden = true;
    return;
  }

  guard.hidden = true;
  content.hidden = false;
  await loadHub();
}

init();
