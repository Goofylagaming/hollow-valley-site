const { api, escapeHtml } = window.HDS;

let featureAnnouncementReady = false;
let featureAnnouncementRequestId = null;
let globalBodyDropState = null;
let globalBodyDropRefreshTimer = null;
let chatMessages = [];
let chatChannel = "all";

function renderChat() {
  const query = document.getElementById("ops-chat-search")?.value.trim().toLowerCase() || "";
  const lagOnly = document.getElementById("ops-chat-lag")?.checked;
  const rows = chatMessages.filter((entry) =>
    (chatChannel === "all" || entry.channel === chatChannel) &&
    (!query || `${entry.name} ${entry.message}`.toLowerCase().includes(query)) &&
    (!lagOnly || /\b(lag|lagging|rubberband|rubber band|desync|ping|stutter|freeze|freezing|delay)\b/i.test(entry.message))
  ).reverse();
  document.getElementById("ops-chat-messages").innerHTML = rows.length
    ? rows.map((entry) => `<tr><td>${escapeHtml(formatDate(entry.at))}</td><td>${escapeHtml(entry.channel)}</td><td>${escapeHtml(entry.name)}${entry.steamId ? `<small style="display:block">${escapeHtml(entry.steamId)}</small>` : ""}</td><td style="white-space:normal;overflow-wrap:anywhere">${escapeHtml(entry.message)}</td></tr>`).join("")
    : emptyRow(4, chatMessages.length ? "No messages match the filter." : "No game chat received yet. Check the game server chat forwarder.");
}

async function loadChat() {
  if (document.hidden) return;
  try {
    const result = await api("/api/admin-operations/chat");
    chatMessages = Array.isArray(result.messages) ? result.messages : [];
    text("ops-chat-status", result.lastReceivedAt ? `Feed last received ${formatDate(result.lastReceivedAt)}` : "Feed not connected");
    renderChat();
  } catch (error) {
    text("ops-chat-status", error.message || "Feed unavailable");
  }
}

document.getElementById("ops-chat-search")?.addEventListener("input", renderChat);
document.getElementById("ops-chat-lag")?.addEventListener("change", renderChat);
document.getElementById("ops-chat-collapse")?.addEventListener("click", (event) => {
  const body = document.getElementById("ops-chat-body");
  body.hidden = !body.hidden;
  event.currentTarget.setAttribute("aria-expanded", String(!body.hidden));
  event.currentTarget.textContent = body.hidden ? "Expand chat" : "Minimize chat";
  try { localStorage.setItem("ops-chat-minimized", String(body.hidden)); } catch (_) { /* Storage may be unavailable. */ }
});
document.getElementById("ops-chat-channels")?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-channel]");
  if (!button) return;
  chatChannel = button.dataset.channel;
  document.querySelectorAll("#ops-chat-channels button").forEach((item) => {
    item.setAttribute("aria-pressed", String(item === button));
  });
  renderChat();
});

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

async function loadSlayAudit() {
  const status = document.getElementById("ops-slay-audit-status");
  const table = document.getElementById("ops-slay-audit");
  if (!table) return;
  try {
    const result = await api("/api/admin-operations/slay-audit");
    const rows = Array.isArray(result.audit) ? result.audit : [];
    table.innerHTML = rows.length
      ? rows.map((item) => {
          const details = item.details || {};
          const actorSteamId = details.actorSteamId || "";
          const actor = actorSteamId
            ? `${escapeHtml(details.actorName || actorSteamId)}<small style="display:block">${escapeHtml(actorSteamId)}</small>`
            : "Not recorded (legacy)";
          const resultText = item.status === "succeeded" && details.confirmed === true
            ? "Confirmed"
            : item.status === "failed" ? "Failed" : item.status || "Unknown";
          return `<tr><td>${escapeHtml(formatDate(item.created_at || item.createdAt))}</td><td>${actor}</td><td>${escapeHtml(details.steamId || "—")}</td><td>${escapeHtml(resultText)}</td></tr>`;
        }).join("")
      : emptyRow(4, "No website Slay actions recorded in the available history.");
    if (status) status.textContent = `${rows.length} most recent website Slay action(s) · older records may have no admin identity`;
  } catch (error) {
    table.innerHTML = emptyRow(4, "Slay history could not be loaded.");
    if (status) status.textContent = error.message || "Audit history unavailable";
  }
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

  const rcon = status.rconControl || {};
  const corpseWipeReady = Boolean(rcon.configured && rcon.actionGates?.wipeCorpses);
  const corpseState = document.getElementById("ops-corpse-wipe-state");
  const corpseButton = document.getElementById("ops-corpse-wipe");
  const corpseMessage = document.getElementById("ops-corpse-wipe-message");
  if (corpseState) {
    corpseState.textContent = corpseWipeReady ? "ARMED" : (rcon.configured ? "GATE OFF" : "RCON UNAVAILABLE");
    corpseState.className = `ops-status-label ${corpseWipeReady ? "ready" : "attention"}`;
  }
  if (corpseButton) {
    corpseButton.disabled = !corpseWipeReady;
    corpseButton.title = corpseWipeReady
      ? "Requires WIPE CORPSES confirmation."
      : (rcon.configured ? "RCON corpse-wipe write gate is disabled." : "Automation RCON is not configured.");
  }
  if (corpseMessage && !corpseMessage.dataset.busy) {
    corpseMessage.textContent = corpseWipeReady
      ? 'Ready. Click Wipe Corpses and type "WIPE CORPSES" to confirm.'
      : (rcon.configured ? "Corpse wipe is present but the backend safety gate is OFF." : "Automation RCON is not currently available.");
  }

  const discordReady = Boolean(status.discordAutomation?.announcementConfigured);
  featureAnnouncementReady = discordReady;
  const featureState = document.getElementById("ops-feature-state");
  if (featureState) {
    featureState.textContent = discordReady ? "HERBYBOT READY" : "HERBYBOT UNAVAILABLE";
    featureState.className = `ops-status-label ${discordReady ? "ready" : "attention"}`;
  }
  updateFeatureAnnouncementPreview();

  const growthReady = Boolean(rcon.configured && rcon.actionGates?.growthMultiplier);
  const growthState = document.getElementById("ops-growth-state");
  const growthButton = document.getElementById("ops-growth-apply");
  const growthMessage = document.getElementById("ops-growth-message");
  if (growthState) {
    growthState.textContent = growthReady ? "EXPERIMENTAL TEST ENABLED" : "TEST GATE OFF";
    growthState.className = `ops-status-label ${growthReady ? "ready" : "attention"}`;
  }
  if (growthButton) {
    growthButton.disabled = !growthReady || Boolean(growthMessage?.dataset.busy);
    growthButton.title = growthReady ? "Experimental request; gameplay effect is unverified" : "Experimental growth gates are disabled";
  }
  if (growthMessage && !growthMessage.dataset.busy && !growthMessage.dataset.result) {
    growthMessage.textContent = growthReady
      ? "Experimental 2×/3× requests available. No automatic restoration or restart; verify gameplay separately."
      : "Experimental growth testing is disabled by the backend.";
  }

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
  loadSlayAudit();
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

function featureAnnouncementPayload() {
  const kind = document.getElementById("ops-feature-type")?.value || "growth";
  return {
    kind,
    multiplier: Number(document.getElementById("ops-feature-growth")?.value),
    message: document.getElementById("ops-feature-custom")?.value.trim() || "",
    channels: [
      ...(document.getElementById("ops-feature-community")?.checked ? ["announcement"] : []),
      ...(document.getElementById("ops-feature-progress")?.checked ? ["progress"] : []),
    ],
  };
}

function featureAnnouncementText(payload) {
  if (payload.kind === "growth") {
    return `🦖 Hollow Valley update: Server growth is now ${payload.multiplier}×! Enjoy the faster growth and happy surviving!`;
  }
  return payload.message || "Enter your verified event announcement above.";
}

function updateFeatureAnnouncementPreview() {
  const payload = featureAnnouncementPayload();
  const growthVisible = payload.kind === "growth";
  const growth = document.getElementById("ops-feature-growth");
  const growthLabel = document.getElementById("ops-feature-growth-label");
  const custom = document.getElementById("ops-feature-custom-wrap");
  if (growth) growth.hidden = !growthVisible;
  if (growthLabel) growthLabel.hidden = !growthVisible;
  if (custom) custom.hidden = growthVisible;
  text("ops-feature-preview", featureAnnouncementText(payload));
  const ready = featureAnnouncementReady &&
    document.getElementById("ops-feature-verified")?.checked &&
    payload.channels.length > 0 && (growthVisible || Boolean(payload.message));
  const button = document.getElementById("ops-feature-publish");
  if (button && !button.dataset.busy) button.disabled = !ready;
}

["ops-feature-type", "ops-feature-growth", "ops-feature-custom",
 "ops-feature-community", "ops-feature-progress", "ops-feature-verified"]
  .forEach((id) => document.getElementById(id)?.addEventListener("input", () => {
    // The persisted content signature below controls request identity.
    const message = document.getElementById("ops-feature-message");
    if (message) delete message.dataset.queued;
    updateFeatureAnnouncementPreview();
  }));

document.getElementById("ops-feature-copy")?.addEventListener("click", async () => {
  const payload = featureAnnouncementPayload();
  const message = featureAnnouncementText(payload);
  try {
    await navigator.clipboard.writeText(message);
    text("ops-feature-message", "Copied. In-game posting requires the private Windows RCON host.");
  } catch {
    text("ops-feature-message", "Clipboard unavailable; copy the preview manually.");
  }
});

document.getElementById("ops-feature-publish")?.addEventListener("click", async (event) => {
  const payload = featureAnnouncementPayload();
  if (!featureAnnouncementReady || !document.getElementById("ops-feature-verified")?.checked ||
      !payload.channels.length || (payload.kind === "custom" && !payload.message)) return;
  if (!window.confirm(
    `Confirm this change is already active and queue this message to Discord?\n\n${featureAnnouncementText(payload)}\n\nQueued messages are not necessarily delivered immediately.`
  )) return;

  const button = event.currentTarget;
  const message = document.getElementById("ops-feature-message");
  button.dataset.busy = "1";
  button.disabled = true;
  if (message) message.textContent = "Queueing verified announcement…";
  try {
    const signature = JSON.stringify(payload);
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem('hv-feature-announcement') || 'null'); } catch {}
    featureAnnouncementRequestId = saved?.signature === signature ? saved.requestId : crypto.randomUUID();
    // Refuse publication if retry identity cannot survive a page reload.
    sessionStorage.setItem('hv-feature-announcement', JSON.stringify({ signature, requestId: featureAnnouncementRequestId }));
    const response = await api("/api/admin-operations/feature-announcement", {
      method: "POST",
      body: JSON.stringify({
        ...payload, requestId: featureAnnouncementRequestId,
        verified: true, confirm: "ANNOUNCE VERIFIED",
      }),
    });
    const receipt = response.announcement || {};
    if (message) {
      message.dataset.queued = "1";
      message.textContent = `Queued to ${(receipt.receipts || []).map((r) => r.destination).join(" and ") || "HerbyBot"}. Check Discord for delivery. No in-game broadcast was sent.`;
    }
    document.getElementById("ops-feature-verified").checked = false;
  } catch (error) {
    if (message) message.textContent = error.message || "Announcement was not queued; check the outbox before retrying.";
  } finally {
    delete button.dataset.busy;
    updateFeatureAnnouncementPreview();
  }
});

document.getElementById("ops-growth-apply")?.addEventListener("click", async (event) => {
  const value = Number(document.getElementById("ops-growth-value")?.value);
  if (![2, 3].includes(value)) return;
  if (window.prompt(
    `Send experimental ${value}× request to the LIVE server?\n\nEffect and scope are unverified and may affect all players. Game.ini stays unchanged. There is NO automatic restoration or restart. A 3× request is not proof of restoration.\n\nType TEST GROWTH to send:`, ""
  ) !== "TEST GROWTH") return;
  const button = event.currentTarget;
  const message = document.getElementById("ops-growth-message");
  button.disabled = true;
  if (message) {
    message.dataset.busy = "1";
    message.textContent = `Requesting ${value}× growth through guarded RCON…`;
  }
  try {
    const response = await api("/api/admin-operations/growth-multiplier", {
      method: "POST",
      body: JSON.stringify({ value, confirm: "TEST GROWTH", experimental: true }),
    });
    const result = response.result || response;
    if (message) {
      message.textContent = result.sent
        ? `Experimental ${value}× request sent; effect NOT verified. Game.ini unchanged. No automatic restoration or restart.`
        : "Growth request completed without a confirmed RCON send.";
    }
  } catch (error) {
    if (message) message.textContent = `${error.message || "Growth request failed."} Delivery may be uncertain; check the server and audit before retrying.`;
  } finally {
    if (message) { delete message.dataset.busy; message.dataset.result = "1"; }
    await loadOperations({ force: true });
  }
});

document.getElementById("ops-corpse-wipe")?.addEventListener("click", async (event) => {
  const confirmText = window.prompt(
    'This removes dead bodies from the live server.\n\nType WIPE CORPSES exactly to continue:',
    ""
  );
  if (confirmText === null) return;
  if (confirmText !== "WIPE CORPSES") {
    window.alert('Corpse wipe cancelled. The confirmation must be exactly "WIPE CORPSES".');
    return;
  }

  const button = event.currentTarget;
  const message = document.getElementById("ops-corpse-wipe-message");
  button.disabled = true;
  button.textContent = "Wiping…";
  if (message) {
    message.dataset.busy = "1";
    message.textContent = "Sending corpse wipe to Evrima RCON…";
  }

  try {
    const result = await api("/api/admin-operations/corpse-wipe", {
      method: "POST",
      body: JSON.stringify({ confirm: confirmText }),
    });
    const action = result.result || result;
    if (message) {
      message.textContent = action.confirmed
        ? "Corpse wipe confirmed by the server."
        : action.sent
          ? "Corpse wipe sent but not confirmed. Check game state before retrying."
          : "Corpse wipe request completed without a confirmed send.";
    }
  } catch (error) {
    if (message) message.textContent = error.message || "Corpse wipe failed.";
  } finally {
    if (message) delete message.dataset.busy;
    button.textContent = "Wipe Corpses";
    await loadOperations({ force: true });
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
  try {
    if (localStorage.getItem("ops-chat-minimized") === "true") {
      document.getElementById("ops-chat-body").hidden = true;
      const button = document.getElementById("ops-chat-collapse");
      button.setAttribute("aria-expanded", "false");
      button.textContent = "Expand chat";
    }
  } catch (_) { /* Storage may be unavailable. */ }
  await Promise.all([loadOperations(), loadSlayAudit(), loadGlobalBodyDrop()]);
  await loadChat();
  setInterval(loadChat, 5000);
}

init();
