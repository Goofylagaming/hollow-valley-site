const { api, escapeHtml } = window.HDS;

let events = [];
let visibleMonth = new Date();
let me = { loggedIn: false, user: null };
let rewardAdmin = null;
let rewardPlayers = [];
visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);

function dateKey(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function formatEventTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatRewardTime(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "—";
}

function eventsOn(date) {
  const key = dateKey(date);
  return events.filter((event) => dateKey(new Date(event.startTime)) === key);
}

function renderCalendar() {
  document.getElementById("calendar-title").textContent = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(visibleMonth);

  const grid = document.getElementById("calendar-grid");
  const month = visibleMonth.getMonth();
  const year = visibleMonth.getFullYear();
  const firstOffset = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = dateKey(new Date());
  const cells = [];

  for (let i = 0; i < firstOffset; i += 1) {
    cells.push('<div class="calendar-day muted"></div>');
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day);
    const dayEvents = eventsOn(date);
    cells.push(`<div class="calendar-day ${dateKey(date) === today ? "today" : ""}">
      <b>${day}</b>
      ${dayEvents.slice(0, 2).map((event) =>
        `<a href="${escapeHtml(event.url)}" target="_blank" rel="noopener" class="calendar-event" title="${escapeHtml(event.title)}">${escapeHtml(event.title)}</a>`
      ).join("")}
      ${dayEvents.length > 2 ? `<small>+${dayEvents.length - 2} more</small>` : ""}
    </div>`);
  }

  grid.innerHTML = cells.join("");
}

function wireEventRewardShortcuts() {
  document.querySelectorAll(".event-reward-shortcut").forEach((button) => {
    button.addEventListener("click", () => {
      document.getElementById("event-reward-event-id").value = button.dataset.eventId || "";
      document.getElementById("event-reward-event-title").value = button.dataset.eventTitle || "";
      document.getElementById("event-admin-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function renderEvents() {
  const list = document.getElementById("event-list");
  const upcoming = events.filter((event) => new Date(event.startTime) >= new Date()).slice(0, 12);

  if (!upcoming.length) {
    list.innerHTML = '<div class="empty-roster"><strong>No upcoming events</strong><span>New Discord events will appear here automatically when the calendar bridge is available.</span></div>';
    return;
  }

  const isAdmin = Boolean(me?.user?.is_admin);
  list.innerHTML = upcoming.map((event) => `
    <article class="event-card">
      <div>
        <small>${formatEventTime(event.startTime)}</small>
        <h3>${escapeHtml(event.title)}</h3>
        ${event.description ? `<p>${escapeHtml(event.description)}</p>` : ""}
        <span>${event.location ? `📍 ${escapeHtml(event.location)}` : "Discord event"}${event.attendees ? ` · ${event.attendees} interested` : ""}</span>
      </div>
      <div class="event-card-actions">
        <a class="small-button" href="${escapeHtml(event.url)}" target="_blank" rel="noopener">View in Discord</a>
        ${isAdmin ? `<button class="small-button event-reward-shortcut" type="button" data-event-id="${escapeHtml(event.id)}" data-event-title="${escapeHtml(event.title)}">Reward players</button>` : ""}
      </div>
    </article>`).join("");

  wireEventRewardShortcuts();
}

function rewardRow(reward) {
  const metadata = reward.metadata || {};
  const title = metadata.eventTitle || reward.reason || "Event reward";
  const base = Number(metadata.baseAmount || reward.amount || 0);
  const multiplier = Number(metadata.supporterMultiplier || 1);
  const payout = Number(metadata.payoutAmount || reward.amount || 0);

  return `<div class="event-reward-row">
    <div>
      <strong>${escapeHtml(title)}</strong>
      <small>${escapeHtml(formatRewardTime(reward.createdAt))}</small>
    </div>
    <span>Base ${base.toLocaleString()}</span>
    <span>${multiplier > 1 ? `Supporter ×${multiplier}` : "Standard reward"}</span>
    <b>+${payout.toLocaleString()}</b>
  </div>`;
}

async function loadMyEventRewards() {
  const container = document.getElementById("my-event-rewards");
  const state = document.getElementById("event-reward-state");

  if (!me.loggedIn) {
    state.textContent = "Steam sign-in required";
    container.innerHTML = '<div class="empty-roster"><strong>Sign in to view rewards</strong><span>Your Steam-linked event payouts will appear here.</span></div>';
    return;
  }

  if (!me.user?.steam_id) {
    state.textContent = "Steam link required";
    container.innerHTML = '<div class="empty-roster"><strong>Steam account not linked</strong><span>Link Steam to receive and view event rewards.</span></div>';
    return;
  }

  try {
    const data = await api("/api/events/rewards/mine");
    const rewards = Array.isArray(data.rewards) ? data.rewards : [];
    state.textContent = rewards.length ? `${rewards.length} recorded payout${rewards.length === 1 ? "" : "s"}` : "No payouts yet";
    container.innerHTML = rewards.length
      ? rewards.map(rewardRow).join("")
      : '<div class="empty-roster"><strong>No event rewards yet</strong><span>Eligible payouts will appear here after an admin awards the event.</span></div>';
  } catch (error) {
    state.textContent = "Unavailable";
    container.innerHTML = `<div class="empty-roster"><strong>Could not load event rewards</strong><span>${escapeHtml(error.message || "Try again shortly.")}</span></div>`;
  }
}

function renderAdminPlayers() {
  const select = document.getElementById("event-reward-player");
  if (!select) return;
  select.innerHTML = '<option value="">Choose a Steam-linked player…</option>' + rewardPlayers.map((player) =>
    `<option value="${escapeHtml(player.steamId)}">${escapeHtml(player.username)} · ${escapeHtml(player.steamId)}</option>`
  ).join("");
}

function renderAdminRewardHistory(rewards) {
  const tbody = document.getElementById("event-admin-history");
  if (!tbody) return;

  if (!rewards.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="ops-empty">No event payouts recorded.</td></tr>';
    return;
  }

  const playerNames = new Map(rewardPlayers.map((player) => [player.steamId, player.username]));
  tbody.innerHTML = rewards.slice(0, 50).map((reward) => {
    const meta = reward.metadata || {};
    const base = Number(meta.baseAmount || reward.amount || 0);
    const multiplier = Number(meta.supporterMultiplier || 1);
    const payout = Number(meta.payoutAmount || reward.amount || 0);
    const player = playerNames.get(reward.steamId) || reward.steamId;
    return `<tr>
      <td>${escapeHtml(meta.eventTitle || reward.eventId || "Event")}</td>
      <td>${escapeHtml(player)}</td>
      <td>${base.toLocaleString()}</td>
      <td>×${multiplier}</td>
      <td>+${payout.toLocaleString()}</td>
      <td>${escapeHtml(formatRewardTime(reward.createdAt))}</td>
    </tr>`;
  }).join("");
}

async function loadAdminRewards() {
  const panel = document.getElementById("event-admin-panel");
  if (!me?.user?.is_admin) {
    panel.hidden = true;
    return;
  }

  panel.hidden = false;
  const statusEl = document.getElementById("event-admin-status");
  const submit = document.getElementById("event-reward-submit");

  try {
    const [playersData, rewardsData] = await Promise.all([
      api("/api/events/admin/players?limit=300"),
      api("/api/events/admin/rewards?limit=100"),
    ]);

    rewardPlayers = Array.isArray(playersData.players) ? playersData.players : [];
    rewardAdmin = rewardsData.state || {};
    renderAdminPlayers();
    renderAdminRewardHistory(Array.isArray(rewardsData.rewards) ? rewardsData.rewards : []);

    if (!rewardAdmin.enabled) {
      statusEl.textContent = "Event payouts are locked by EVENT_REWARDS_ENABLED. History and setup are available, but no coins can be issued yet.";
      statusEl.classList.add("locked");
      submit.disabled = true;
    } else if (rewardAdmin.supporterMultipliersEnabled && !rewardAdmin.supporterLookupConfigured) {
      statusEl.textContent = "Event payouts are paused because supporter lookup is not configured.";
      statusEl.classList.add("locked");
      submit.disabled = true;
    } else {
      statusEl.textContent = rewardAdmin.supporterMultipliersEnabled
        ? "Event payouts enabled · official supporter multipliers apply automatically."
        : "Event payouts enabled · supporter multipliers are currently disabled.";
      statusEl.classList.remove("locked");
      submit.disabled = rewardPlayers.length === 0;
    }
  } catch (error) {
    statusEl.textContent = error.message || "Event reward administration is unavailable.";
    statusEl.classList.add("locked");
    submit.disabled = true;
  }
}

async function init() {
  try {
    me = await window.HDS.loadMe();
  } catch {
    me = { loggedIn: false, user: null };
  }

  try {
    const data = await api("/api/events");
    events = data.events || [];
    renderCalendar();
    renderEvents();
    if (data.configured && data.stale) {
      const list = document.getElementById("event-list");
      list.insertAdjacentHTML("afterbegin", '<div class="map-history-note">Discord event sync is temporarily stale. Showing the last successful HerbyBot snapshot.</div>');
    }
    if (!data.configured) {
      document.getElementById("event-list").innerHTML = '<div class="empty-roster"><strong>Discord event calendar is not connected on this service</strong><span>Admins can still use the event reward panel with a manual event ID and title.</span></div>';
    }
  } catch (error) {
    console.error("Failed to load Discord events", error);
    document.getElementById("event-list").innerHTML = '<div class="empty-roster"><strong>Events are temporarily unavailable</strong><span>The reward ledger remains independent of the Discord calendar.</span></div>';
    renderCalendar();
  }

  await Promise.all([loadMyEventRewards(), loadAdminRewards()]);
}

document.getElementById("event-reward-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = document.getElementById("event-reward-submit");
  const message = document.getElementById("event-admin-message");

  const payload = {
    eventId: document.getElementById("event-reward-event-id").value.trim(),
    eventTitle: document.getElementById("event-reward-event-title").value.trim(),
    steamId: document.getElementById("event-reward-player").value,
    baseAmount: Number(document.getElementById("event-reward-base").value),
  };

  const player = rewardPlayers.find((entry) => entry.steamId === payload.steamId);
  if (!payload.eventId || !payload.eventTitle || !payload.steamId || !Number.isSafeInteger(payload.baseAmount) || payload.baseAmount <= 0) {
    message.textContent = "Complete the event, player and base reward fields first.";
    return;
  }

  if (!confirm(`Award ${payload.baseAmount.toLocaleString()} base Valley Coin for "${payload.eventTitle}" to ${player?.username || payload.steamId}? Supporter multiplier is applied automatically.`)) {
    return;
  }

  submit.disabled = true;
  submit.textContent = "Awarding…";
  message.textContent = "";

  try {
    const result = await api("/api/events/admin/reward", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    message.textContent = result.duplicate
      ? "This player already received the reward for this event. No duplicate coins were issued."
      : `Awarded ${Number(result.payoutAmount || 0).toLocaleString()} Valley Coin (${Number(result.baseAmount || 0).toLocaleString()} base ×${Number(result.supporterMultiplier || 1)}).`;

    await Promise.all([loadAdminRewards(), loadMyEventRewards()]);
  } catch (error) {
    message.textContent = error.message || "Could not award event reward.";
  } finally {
    submit.textContent = "Award event reward →";
    submit.disabled = !rewardAdmin?.enabled || rewardPlayers.length === 0;
  }
});

document.getElementById("calendar-previous")?.addEventListener("click", () => {
  visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1);
  renderCalendar();
});

document.getElementById("calendar-next")?.addEventListener("click", () => {
  visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1);
  renderCalendar();
});

init();
