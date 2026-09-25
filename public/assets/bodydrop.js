const { api, escapeHtml } = window.HDS;

let refreshTimer = null;
let countdownTimer = null;
let busy = false;
let currentBodyDropData = null;

function formatCooldown(seconds) {
  if (seconds === null || seconds === undefined) return "pending";
  const total = Math.max(0, Math.ceil(Number(seconds) || 0));
  const mins = Math.floor(total / 60);
  const secs = Math.floor(total % 60);
  return mins <= 0 ? `${secs}s` : `${mins}m ${String(secs).padStart(2, "0")}s`;
}

function remainingCooldownSeconds(data = currentBodyDropData) {
  const next = data?.cooldown?.nextAvailableAt;
  if (next) {
    const target = new Date(next).getTime();
    if (Number.isFinite(target)) return Math.max(0, Math.ceil((target - Date.now()) / 1000));
  }
  const fallback = data?.cooldown?.remainingSeconds;
  return fallback === null || fallback === undefined ? null : Math.max(0, Math.ceil(Number(fallback) || 0));
}

function stopCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = null;
}

function updateCountdownDisplay() {
  if (currentBodyDropData?.cooldown?.reason !== "cooldown") return;
  const status = document.getElementById("bodydrop-status-text");
  const remaining = remainingCooldownSeconds();
  if (status) status.textContent = `Cooldown ${formatCooldown(remaining)}`;
  if (remaining !== null && remaining <= 0) {
    stopCountdown();
    loadBodyDropStatus();
  }
}

function startCountdown() {
  stopCountdown();
  if (currentBodyDropData?.cooldown?.reason !== "cooldown") return;
  updateCountdownDisplay();
  countdownTimer = setInterval(updateCountdownDisplay, 1000);
}

function nutrientGroupLabel(nutrient) {
  if (nutrient === "protein") return { symbol: "S", label: "PROTEIN" };
  if (nutrient === "carbohydrate") return { symbol: "∴", label: "CARBOHYDRATE" };
  if (nutrient === "lipid") return { symbol: "//", label: "LIPID" };
  return { symbol: "•", label: String(nutrient || "DIET").toUpperCase() };
}

function renderBodyDropStatus(data) {
  const container = document.getElementById("bodydrop-content");
  if (!container) return;

  currentBodyDropData = data;
  const eligibilityBlocked = data.eligibility?.eligible === false && Boolean(data.eligibility?.reason);
  const dietBlocked = data.dietEligibility?.eligible === false && Boolean(data.dietEligibility?.reason);
  const status = !data.steamLinked
    ? "Steam account required"
    : !data.serverOnline
      ? "Server sync offline"
      : data.cooldown?.active
        ? data.cooldown.reason === "pending"
          ? "Request pending"
          : `Cooldown ${formatCooldown(remainingCooldownSeconds(data))}`
        : eligibilityBlocked
          ? data.eligibility.reason
          : dietBlocked
            ? data.dietEligibility.reason
            : "Available now";

  const disabled = !data.steamLinked || !data.serverOnline || data.cooldown?.active || eligibilityBlocked || dietBlocked;
  const requester = data.requester || null;
  const requesterSpecies = requester?.species || data.eligibility?.species || "No live dinosaur";
  const requesterGrowth = Number.isFinite(requester?.growthPercent) ? Math.round(requester.growthPercent) : null;
  const corpseGrowth = Number.isFinite(data.corpseGrowthPercent) ? Math.round(data.corpseGrowthPercent) : null;

  const grouped = new Map();
  for (const option of data.options || []) {
    const nutrient = option.nutrient || "diet";
    if (!grouped.has(nutrient)) grouped.set(nutrient, []);
    grouped.get(nutrient).push(option);
  }

  const order = ["protein", "carbohydrate", "lipid"];
  const groups = order
    .filter((nutrient) => grouped.has(nutrient))
    .map((nutrient) => {
      const meta = nutrientGroupLabel(nutrient);
      const buttons = grouped.get(nutrient).map((option) => `
        <button class="bodydrop-option diet-option" data-drop-type="${escapeHtml(option.id)}" data-prey="${escapeHtml(option.species)}" ${disabled ? "disabled" : ""}>
          <strong>${escapeHtml(option.species)}</strong>
          <span>${escapeHtml(option.nutrientLabel || meta.label)} diet body</span>
          <small>${Number.isFinite(option.growthPercent) ? `Spawns at ${Math.round(option.growthPercent)}% growth` : "Scaled to your growth"}</small>
        </button>`).join("");

      return `
        <section class="bodydrop-diet-group">
          <div class="bodydrop-diet-heading">
            <b>${escapeHtml(meta.symbol)}</b>
            <span>${escapeHtml(meta.label)}</span>
          </div>
          <div class="bodydrop-options">${buttons}</div>
        </section>`;
    }).join("");

  const noOptions = !groups
    ? `<div class="bodydrop-empty-diet"><strong>No configured diet drops</strong><span>${escapeHtml(data.dietEligibility?.reason || data.eligibility?.reason || "This dinosaur does not have a Hollow Valley BodyDrop diet configured yet.")}</span></div>`
    : "";

  container.innerHTML = `
    <div class="bodydrop-character">
      <div>
        <small>YOUR CURRENT DINO</small>
        <strong>${escapeHtml(requesterSpecies)}</strong>
      </div>
      <div class="bodydrop-character-stats">
        <span>Growth <b>${requesterGrowth === null ? "—" : `${requesterGrowth}%`}</b></span>
        <span>Drop size <b>${corpseGrowth === null ? "—" : `${corpseGrowth}%`}</b></span>
      </div>
    </div>
    <div class="bodydrop-status ${disabled ? "blocked" : "ready"}"><b id="bodydrop-status-text">${escapeHtml(status)}</b></div>
    <div class="bodydrop-diet-list">${groups || noOptions}</div>
    <p class="bodydrop-diet-note">Diet choices are validated again against your live dinosaur before the corpse is queued. Body size is 75% of your current growth, clamped between 15% and 40%.</p>`;

  startCountdown();

  container.querySelectorAll(".bodydrop-option").forEach((button) => {
    button.addEventListener("click", async () => {
      const prey = button.dataset.prey || "this body";
      const sizeText = corpseGrowth === null ? "" : ` at ${corpseGrowth}% growth`;
      if (!confirm(`Request ${prey}${sizeText} on the live server?`)) return;
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
    } else if (data.cooldown?.reason === "cooldown") {
      // Countdown ticks locally every second; periodically re-sync with the
      // server so a clock change or operator reconciliation cannot drift.
      refreshTimer = setTimeout(loadBodyDropStatus, 30000);
    }
  } catch (error) {
    stopCountdown();
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
