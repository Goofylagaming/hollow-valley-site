const { api, escapeHtml } = window.HDS;

function text(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? "—";
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function safeJobMessage(job) {
  return String(job?.payload?.message || "").trim() || "—";
}

function render(data) {
  const discord = data.discord || {};
  const jobsState = data.jobs || {};
  const summary = jobsState.summary || {};
  const jobs = Array.isArray(jobsState.jobs) ? jobsState.jobs : [];
  const outbox = discord.outbox || {};

  text("comms-configured", discord.configured ? "Connected" : "Not configured");
  text("comms-delivery", discord.deliveryMode || "—");
  text("comms-status-channel", discord.lastStatusChannelName || "Not synced");
  text("comms-status-sync", discord.lastSyncAt ? `Last sync ${formatDate(discord.lastSyncAt)}` : "No sync recorded");
  text("comms-scheduled-count", String(Number(summary.scheduled || 0)));
  text("comms-job-summary", `${Number(summary.completed || 0)} completed · ${Number(summary.failed || 0)} failed`);
  text("comms-outbox", String(Number(outbox.pending || outbox.queued || 0)));
  text("comms-outbox-detail", `${Number(outbox.delivered || 0)} delivered · ${Number(outbox.failed || 0)} failed`);

  const tbody = document.getElementById("comms-jobs");
  tbody.innerHTML = jobs.length ? jobs.slice(0, 40).map((job) => {
    const canCancel = ["scheduled", "failed"].includes(String(job.status || ""));
    return `<tr>
      <td>${escapeHtml(formatDate(job.run_at || job.runAt))}</td>
      <td>${escapeHtml(job.recurrence || "none")}</td>
      <td><span class="ops-status-label ${escapeHtml(job.status || "")}">${escapeHtml(job.status || "—")}</span></td>
      <td class="comms-job-message">${escapeHtml(safeJobMessage(job))}</td>
      <td>${canCancel ? `<button class="small-button comms-cancel-job" data-job-id="${escapeHtml(job.id)}">Cancel</button>` : ""}</td>
    </tr>`;
  }).join("") : '<tr><td colspan="5" class="ops-empty">No scheduled announcements.</td></tr>';

  tbody.querySelectorAll(".comms-cancel-job").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.jobId;
      if (!confirm("Cancel this scheduled announcement?")) return;
      button.disabled = true;
      try {
        await api(`/api/admin-comms/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" });
        await loadComms();
      } catch (error) {
        alert(error.message || "Could not cancel scheduled announcement.");
        button.disabled = false;
      }
    });
  });
}

async function loadComms() {
  const msg = document.getElementById("comms-message");
  if (msg) msg.textContent = "Loading…";
  try {
    const data = await api("/api/admin-comms");
    render(data);
    if (msg) msg.textContent = "Up to date";
  } catch (error) {
    if (msg) msg.textContent = error.message || "Comms unavailable";
  }
}

document.getElementById("comms-refresh")?.addEventListener("click", loadComms);

document.getElementById("comms-sync-status")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const msg = document.getElementById("comms-message");
  button.disabled = true;
  if (msg) msg.textContent = "Syncing…";
  try {
    const result = await api("/api/admin-comms/sync-status", { method: "POST" });
    if (msg) msg.textContent = result.message || result.name || "Status sync queued";
    await loadComms();
  } catch (error) {
    if (msg) msg.textContent = error.message || "Status sync failed";
  } finally {
    button.disabled = false;
  }
});

document.getElementById("comms-announce-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const message = document.getElementById("comms-announce-message").value.trim();
  if (!message) return;
  if (!confirm("Queue this announcement to Discord now?")) return;
  button.disabled = true;
  try {
    await api("/api/admin-comms/announce", {
      method: "POST",
      body: JSON.stringify({ message }),
    });
    document.getElementById("comms-announce-message").value = "";
    text("comms-message", "Announcement queued through HerbyBot");
    await loadComms();
  } catch (error) {
    text("comms-message", error.message || "Announcement failed");
  } finally {
    button.disabled = false;
  }
});

document.getElementById("comms-schedule-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const message = document.getElementById("comms-schedule-message").value.trim();
  const localRunAt = document.getElementById("comms-run-at").value;
  const recurrence = document.getElementById("comms-recurrence").value;
  const date = new Date(localRunAt);
  if (!message || !localRunAt || !Number.isFinite(date.getTime())) return;

  button.disabled = true;
  try {
    await api("/api/admin-comms/schedule", {
      method: "POST",
      body: JSON.stringify({ message, runAt: date.toISOString(), recurrence }),
    });
    document.getElementById("comms-schedule-message").value = "";
    text("comms-message", "Announcement scheduled");
    await loadComms();
  } catch (error) {
    text("comms-message", error.message || "Scheduling failed");
  } finally {
    button.disabled = false;
  }
});

async function init() {
  const me = await window.HDS.loadMe();
  const guard = document.getElementById("comms-guard");
  const content = document.getElementById("comms-content");

  if (!me.loggedIn || !me.user?.is_admin) {
    guard.hidden = false;
    guard.innerHTML = '<p class="section-intro">Admin access is required.</p>';
    content.hidden = true;
    return;
  }

  guard.hidden = true;
  content.hidden = false;
  await loadComms();
}

init();
