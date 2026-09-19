const { api, escapeHtml } = window.HDS;

let refreshTimer = null;
let busy = false;

function formatCooldown(seconds) {
  if (seconds === null || seconds === undefined) return "pending";
  const total = Math.max(0, Number(seconds) || 0);
  const mins = Math.floor(total / 60);
  const secs = Math.floor(total % 60);
  return mins <= 0 ? `${secs}s` : `${mins}m ${String(secs).padStart(2, "0")}s`;
}

function renderBodyDropStatus(data) {
  const container = document.getElementById("bodydrop-content");
  if (!container) return;

  const eligibilityBlocked = data.eligibility?.eligible === false && Boolean(data.eligibility?.reason);
  const status = !data.steamLinked
    ? "Steam account required"
    : !data.serverOnline
      ? "Server sync offline"
      : data.cooldown?.active
        ? data.cooldown.reason === "pending"
          ? "Request pending"
          : `Cooldown ${formatCooldown(data.cooldown.remainingSeconds)}`
        : eligibilityBlocked
          ? data.eligibility.reason
          : "Available now";

  const disabled = !data.steamLinked || !data.serverOnline || data.cooldown?.active || eligibilityBlocked;
  const options = (data.options || []).map((option) => `
    <button class="bodydrop-option" data-drop-type="${escapeHtml(option.id)}" ${disabled ? "disabled" : ""}>
      <strong>${escapeHtml(option.name)}</strong>
      <span>${escapeHtml(option.description)}</span>
    </button>`).join("");

  container.innerHTML = `
    <div class="bodydrop-status ${disabled ? "blocked" : "ready"}"><b>${escapeHtml(status)}</b></div>
    <div class="bodydrop-options">${options}</div>`;

  container.querySelectorAll(".bodydrop-option").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("Request this body drop on the live server?")) return;
      button.disabled = true;
      try {
        const response = await api("/api/bodydrop", {
          method: "POST",
          body: JSON.stringify({ dropType: button.dataset.dropType }),
        });
        alert(response.result?.message || "Body drop requested.");
      } catch (error) {
        alert(error.message || "Failed to request body drop.");
      }
      await loadBodyDropStatus();
    });
  });
}

async function loadBodyDropStatus() {
  if (busy) return;
  clearTimeout(refreshTimer);
  busy = true;
  try {
    const data = await api("/api/bodydrop");
    renderBodyDropStatus(data);
    if (data.cooldown?.reason === "pending") {
      refreshTimer = setTimeout(loadBodyDropStatus, 10000);
    }
  } catch (error) {
    const container = document.getElementById("bodydrop-content");
    if (container) {
      container.innerHTML = `<p class="section-intro" style="color:#ef9a8a;">${escapeHtml(error.message || "BodyDrop is unavailable right now.")}</p>`;
    }
    refreshTimer = setTimeout(loadBodyDropStatus, 30000);
  } finally {
    busy = false;
  }
}

async function init() {
  const me = await window.HDS.loadMe();
  const guard = document.getElementById("bodydrop-guard");
  const content = document.getElementById("bodydrop-page-content");

  if (!me.loggedIn) {
    guard.hidden = false;
    content.hidden = true;
    return;
  }

  guard.hidden = true;
  content.hidden = false;
  await loadBodyDropStatus();
}

init();
