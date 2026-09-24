const { api, escapeHtml } = window.HDS;

let events = [];
let visibleMonth = new Date();
let me = { loggedIn: false, user: null };
let myAttendance = new Map();
let rewardAdmin = null;
let rewardPlayers = [];
let adminAttendance = [];
let selectedAdminEvent = null;
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

function playerName(steamId) {
  return rewardPlayers.find((entry) => entry.steamId === steamId)?.username || steamId;
}

function eventById(eventId) {
  return events.find((event) => String(event.id) === String(eventId)) || null;
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

  for (let i = 0; i < firstOffset; i += 1) cells.push('<div class="calendar-day muted"></div>');

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

function attendanceButton(event) {
  const record = myAttendance.get(String(event.id));
  if (!me.loggedIn || !me.user?.steam_id) {
    return '<button class="small-button" type="button" disabled>Link Steam to attend</button>';
  }
  if (record?.status === "paid") {
    return `<button class="small-button event-rsvp paid" type="button" disabled>✓ Reward paid · +${Number(record.payoutAmount || 0).toLocaleString()} VC</button>`;
  }
  if (record?.status === "attending") {
    return `<button class="small-button event-rsvp active" type="button" data-event-id="${escapeHtml(event.id)}" data-attending="false">✓ Attending</button>`;
  }
  return `<button class="small-button event-rsvp" type="button" data-event-id="${escapeHtml(event.id)}" data-attending="true">+ Attending</button>`;
}

function renderEvents() {
  const list = document.getElementById("event-list");
  const upcoming = events.filter((event) => new Date(event.startTime) >= new Date()).slice(0, 20);

  if (!upcoming.length) {
    list.innerHTML = '<div class="empty-roster"><strong>No upcoming events</strong><span>New Discord events will appear here automatically.</span></div>';
    return;
  }

  const isAdmin = Boolean(me?.user?.is_admin);
  list.innerHTML = upcoming.map((event) => {
    const record = myAttendance.get(String(event.id));
    const personal = record?.status === "attending"
      ? '<small class="event-personal-state">You are on the attending list.</small>'
      : record?.status === "paid"
        ? `<small class="event-personal-state paid">Attendance confirmed · +${Number(record.payoutAmount || 0).toLocaleString()} VC</small>`
        : "";
    return `
      <article class="event-card">
        <div>
          <small>${formatEventTime(event.startTime)}</small>
          <h3>${escapeHtml(event.title)}</h3>
          ${event.description ? `<p>${escapeHtml(event.description)}</p>` : ""}
          <span>${event.location ? `📍 ${escapeHtml(event.location)}` : "Discord event"}${event.attendees ? ` · ${event.attendees} interested` : ""}</span>
          ${personal}
        </div>
        <div class="event-card-actions">
          ${attendanceButton(event)}
          <a class="small-button" href="${escapeHtml(event.url)}" target="_blank" rel="noopener">View in Discord</a>
          ${isAdmin ? `<button class="small-button event-manage-attendance" type="button" data-event-id="${escapeHtml(event.id)}">Manage attendance</button>` : ""}
        </div>
      </article>`;
  }).join("");

  wireEventActions();
}

async function setRsvp(event, attending, button) {
  button.disabled = true;
  const previous = button.textContent;
  button.textContent = attending ? "Adding…" : "Removing…";
  try {
    await api("/api/events/attendance", {
      method: "POST",
      body: JSON.stringify({
        eventId: event.id,
        eventTitle: event.title,
        eventStart: event.startTime || null,
        eventEnd: event.endTime || null,
        attending,
      }),
    });
    await loadMyAttendance();
    renderEvents();
  } catch (error) {
    alert(error.message || "Could not update attendance.");
    button.disabled = false;
    button.textContent = previous;
  }
}

function wireEventActions() {
  document.querySelectorAll(".event-rsvp[data-event-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const event = eventById(button.dataset.eventId);
      if (!event) return;
      setRsvp(event, button.dataset.attending === "true", button);
    });
  });

  document.querySelectorAll(".event-manage-attendance").forEach((button) => {
    button.addEventListener("click", async () => {
      const event = eventById(button.dataset.eventId);
      if (!event) return;
      selectedAdminEvent = event;
      renderSelectedAdminEvent();
      await loadAdminAttendance();
      document.getElementById("event-admin-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function rewardRow(reward) {
  const metadata = reward.metadata || {};
  const title = metadata.eventTitle || reward.reason || "Event reward";
  const base = Number(metadata.baseAmount || reward.amount || 0);
  const multiplier = Number(metadata.supporterMultiplier || 1);
  const payout = Number(metadata.payoutAmount || reward.amount || 0);
  const type = metadata.rewardType === "bonus"
    ? (metadata.bonusLabel || "Bonus")
    : metadata.rewardType === "attendance"
      ? "Attendance"
      : "Manual reward";

  return `<div class="event-reward-row">
    <div>
      <strong>${escapeHtml(title)}</strong>
      <small>${escapeHtml(type)} · ${escapeHtml(formatRewardTime(reward.createdAt))}</small>
    </div>
    <span>Base ${base.toLocaleString()}</span>
    <span>${multiplier > 1 ? `Supporter ×${multiplier}` : "Standard reward"}</span>
    <b>+${payout.toLocaleString()}</b>
  </div>`;
}

async function loadMyAttendance() {
  myAttendance = new Map();
  if (!me.loggedIn || !me.user?.steam_id) return;
  try {
    const data = await api("/api/events/attendance/mine");
    for (const item of Array.isArray(data.attendance) ? data.attendance : []) {
      myAttendance.set(String(item.eventId), item);
    }
  } catch (error) {
    console.warn("Could not load event attendance", error);
  }
}

async function loadMyEventRewards() {
  const container = document.getElementById("my-event-rewards");
  const state = document.getElementById("event-reward-state");

  if (!me.loggedIn) {
    state.textContent = "Steam sign-in required";
    container.innerHTML = '<div class="empty-roster"><strong>Sign in to view rewards</strong><span>Your event payouts will appear here.</span></div>';
    return;
  }
  if (!me.user?.steam_id) {
    state.textContent = "Steam link required";
    container.innerHTML = '<div class="empty-roster"><strong>Steam account not linked</strong><span>Link Steam to RSVP and receive rewards.</span></div>';
    return;
  }

  try {
    const data = await api("/api/events/rewards/mine");
    const rewards = Array.isArray(data.rewards) ? data.rewards : [];
    state.textContent = rewards.length ? `${rewards.length} recorded payout${rewards.length === 1 ? "" : "s"}` : "No payouts yet";
    container.innerHTML = rewards.length
      ? rewards.map(rewardRow).join("")
      : '<div class="empty-roster"><strong>No event rewards yet</strong><span>Attendance and bonus payouts will appear here.</span></div>';
  } catch (error) {
    state.textContent = "Unavailable";
    container.innerHTML = `<div class="empty-roster"><strong>Could not load event rewards</strong><span>${escapeHtml(error.message || "Try again shortly.")}</span></div>`;
  }
}

function renderPlayerDatalist() {
  const list = document.getElementById("event-player-options");
  if (!list) return;
  list.innerHTML = rewardPlayers.map((player) =>
    `<option value="${escapeHtml(player.steamId)}">${escapeHtml(player.username)}</option>`
  ).join("");
}

function renderAdminRewardHistory(rewards) {
  const tbody = document.getElementById("event-admin-history");
  if (!tbody) return;
  if (!rewards.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="ops-empty">No event payouts recorded.</td></tr>';
    return;
  }

  tbody.innerHTML = rewards.slice(0, 100).map((reward) => {
    const meta = reward.metadata || {};
    const base = Number(meta.baseAmount || reward.amount || 0);
    const multiplier = Number(meta.supporterMultiplier || 1);
    const payout = Number(meta.payoutAmount || reward.amount || 0);
    const type = meta.rewardType === "bonus"
      ? (meta.bonusLabel || "Bonus")
      : meta.rewardType === "attendance"
        ? "Attendance"
        : "Manual";
    return `<tr>
      <td>${escapeHtml(meta.eventTitle || reward.eventId || "Event")}</td>
      <td>${escapeHtml(playerName(reward.steamId))}</td>
      <td>${escapeHtml(type)}</td>
      <td>${base.toLocaleString()}</td>
      <td>×${multiplier}</td>
      <td>+${payout.toLocaleString()}</td>
      <td>${escapeHtml(formatRewardTime(reward.createdAt))}</td>
    </tr>`;
  }).join("");
}

function renderSelectedAdminEvent() {
  const title = document.getElementById("event-admin-selected-title");
  const time = document.getElementById("event-admin-selected-time");
  const add = document.getElementById("event-attendance-add-submit");
  const bonus = document.getElementById("event-bonus-submit");
  const confirmAll = document.getElementById("event-confirm-all");

  if (!selectedAdminEvent) {
    title.textContent = "Choose an event above";
    time.textContent = "Use “Manage attendance” on an event card.";
    add.disabled = true;
    bonus.disabled = true;
    confirmAll.disabled = true;
    return;
  }

  title.textContent = selectedAdminEvent.title;
  time.textContent = formatEventTime(selectedAdminEvent.startTime);
  const payoutsReady = rewardAdmin?.enabled && (!rewardAdmin.supporterMultipliersEnabled || rewardAdmin.supporterLookupConfigured);
  add.disabled = false;
  bonus.disabled = !payoutsReady;
  confirmAll.disabled = !payoutsReady || !adminAttendance.some((entry) => entry.status === "attending");
}

function renderAdminAttendance() {
  const tbody = document.getElementById("event-attendance-table");
  const count = document.getElementById("event-attendance-count");
  if (!selectedAdminEvent) {
    tbody.innerHTML = '<tr><td colspan="5" class="ops-empty">Select an event to manage attendance.</td></tr>';
    count.textContent = "No event selected";
    return;
  }

  const visible = adminAttendance.filter((entry) => entry.status !== "withdrawn");
  count.textContent = `${visible.length} attendee${visible.length === 1 ? "" : "s"}`;
  if (!visible.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="ops-empty">Nobody is on the attending list yet.</td></tr>';
    renderSelectedAdminEvent();
    return;
  }

  tbody.innerHTML = visible.map((entry) => {
    const paid = entry.status === "paid";
    const source = entry.source === "admin" ? "Admin added" : "Website RSVP";
    const status = paid
      ? `${escapeHtml(entry.supporterTierLabel || "Regular")} · ×${Number(entry.supporterMultiplier || 1)}`
      : "Awaiting confirmation";
    const payout = paid ? `+${Number(entry.payoutAmount || 0).toLocaleString()} VC` : "—";
    const actions = paid
      ? '<span class="event-paid-chip">PAID</span>'
      : `<button class="small-button event-confirm-one" type="button" data-steam-id="${escapeHtml(entry.steamId)}">✓ They attended</button>
         <button class="small-button event-remove-one" type="button" data-steam-id="${escapeHtml(entry.steamId)}">Remove</button>`;
    return `<tr>
      <td>${escapeHtml(playerName(entry.steamId))}<small class="event-steam-id">${escapeHtml(entry.steamId)}</small></td>
      <td>${escapeHtml(source)}</td>
      <td>${status}</td>
      <td>${payout}</td>
      <td><div class="event-row-actions">${actions}</div></td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll(".event-confirm-one").forEach((button) => {
    button.addEventListener("click", () => confirmOneAttendance(button.dataset.steamId, button));
  });
  tbody.querySelectorAll(".event-remove-one").forEach((button) => {
    button.addEventListener("click", () => removeOneAttendance(button.dataset.steamId, button));
  });
  renderSelectedAdminEvent();
}

async function loadAdminAttendance() {
  adminAttendance = [];
  if (!me?.user?.is_admin || !selectedAdminEvent) {
    renderAdminAttendance();
    return;
  }
  try {
    const data = await api(`/api/events/admin/attendance?eventId=${encodeURIComponent(selectedAdminEvent.id)}`);
    adminAttendance = Array.isArray(data.attendance) ? data.attendance : [];
    rewardAdmin = { ...(rewardAdmin || {}), ...(data.state || {}) };
    renderAdminAttendance();
    renderAdminStatus();
  } catch (error) {
    document.getElementById("event-attendance-table").innerHTML =
      `<tr><td colspan="5" class="ops-empty">${escapeHtml(error.message || "Could not load attendance.")}</td></tr>`;
  }
}

function renderAdminStatus() {
  const statusEl = document.getElementById("event-admin-status");
  if (!statusEl || !rewardAdmin) return;

  if (!rewardAdmin.enabled) {
    statusEl.textContent = "Event payouts are locked by EVENT_REWARDS_ENABLED. Attendance can still be collected, but coins cannot be issued.";
    statusEl.classList.add("locked");
  } else if (rewardAdmin.supporterMultipliersEnabled && !rewardAdmin.supporterLookupConfigured) {
    statusEl.textContent = "Attendance is available, but payouts are paused because supporter lookup is not configured.";
    statusEl.classList.add("locked");
  } else {
    const m = rewardAdmin.attendanceMultipliers || { regular: 1, member: 1.5, elite: 3, legend: 5 };
    statusEl.textContent = `Attendance payout: ${Number(rewardAdmin.baseAttendanceVc || 10000).toLocaleString()} VC base · Regular ×${m.regular || 1} · Member ×${m.member || 1.5} · Elite ×${m.elite || 3} · Legend ×${m.legend || 5}.`;
    statusEl.classList.remove("locked");
  }
  renderSelectedAdminEvent();
}

async function loadAdminRewards() {
  const panel = document.getElementById("event-admin-panel");
  if (!me?.user?.is_admin) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;

  try {
    const [playersData, rewardsData, attendanceData] = await Promise.all([
      api("/api/events/admin/players?limit=500"),
      api("/api/events/admin/rewards?limit=100"),
      api("/api/events/admin/attendance?limit=1"),
    ]);
    rewardPlayers = Array.isArray(playersData.players) ? playersData.players : [];
    rewardAdmin = { ...(rewardsData.state || {}), ...(attendanceData.state || {}) };
    renderPlayerDatalist();
    renderAdminRewardHistory(Array.isArray(rewardsData.rewards) ? rewardsData.rewards : []);
    renderAdminStatus();
  } catch (error) {
    const statusEl = document.getElementById("event-admin-status");
    statusEl.textContent = error.message || "Event reward administration is unavailable.";
    statusEl.classList.add("locked");
  }
}

async function confirmOneAttendance(steamId, button) {
  if (!selectedAdminEvent) return;
  const name = playerName(steamId);
  if (!confirm(`Confirm that ${name} attended "${selectedAdminEvent.title}" and issue their attendance reward now?`)) return;
  button.disabled = true;
  button.textContent = "Paying…";
  const message = document.getElementById("event-admin-message");
  try {
    const result = await api("/api/events/admin/attendance/confirm", {
      method: "POST",
      body: JSON.stringify({ eventId: selectedAdminEvent.id, steamId }),
    });
    message.textContent = `${name}: +${Number(result.payoutAmount || 0).toLocaleString()} VC (${result.supporterTierLabel || "Regular"} ×${Number(result.supporterMultiplier || 1)}).`;
    await Promise.all([loadAdminAttendance(), loadAdminRewards(), loadMyEventRewards(), loadMyAttendance()]);
    renderEvents();
  } catch (error) {
    message.textContent = error.message || "Could not confirm attendance.";
    button.disabled = false;
    button.textContent = "✓ They attended";
  }
}

async function removeOneAttendance(steamId, button) {
  if (!selectedAdminEvent) return;
  if (!confirm(`Remove ${playerName(steamId)} from the attending list for this event?`)) return;
  button.disabled = true;
  try {
    await api("/api/events/admin/attendance/remove", {
      method: "POST",
      body: JSON.stringify({ eventId: selectedAdminEvent.id, steamId }),
    });
    await loadAdminAttendance();
  } catch (error) {
    alert(error.message || "Could not remove attendee.");
    button.disabled = false;
  }
}

document.getElementById("event-attendance-add-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedAdminEvent) return;
  const steamId = document.getElementById("event-attendance-steam").value.trim();
  const submit = document.getElementById("event-attendance-add-submit");
  const message = document.getElementById("event-admin-message");
  if (!/^\d{17}$/.test(steamId)) {
    message.textContent = "Enter a valid 17-digit Steam ID.";
    return;
  }
  submit.disabled = true;
  submit.textContent = "Adding…";
  try {
    await api("/api/events/admin/attendance/add", {
      method: "POST",
      body: JSON.stringify({
        steamId,
        eventId: selectedAdminEvent.id,
        eventTitle: selectedAdminEvent.title,
        eventStart: selectedAdminEvent.startTime || null,
        eventEnd: selectedAdminEvent.endTime || null,
      }),
    });
    document.getElementById("event-attendance-steam").value = "";
    message.textContent = `${playerName(steamId)} added to the attending list.`;
    await loadAdminAttendance();
  } catch (error) {
    message.textContent = error.message || "Could not add attendee.";
  } finally {
    submit.textContent = "+ Add attendee";
    submit.disabled = !selectedAdminEvent;
  }
});

document.getElementById("event-confirm-all")?.addEventListener("click", async () => {
  if (!selectedAdminEvent) return;
  const pending = adminAttendance.filter((entry) => entry.status === "attending");
  if (!pending.length) return;
  if (!confirm(`Confirm all ${pending.length} pending attendees for "${selectedAdminEvent.title}"? This immediately issues each player's tier-based Valley Coin payout.`)) return;
  const button = document.getElementById("event-confirm-all");
  const message = document.getElementById("event-admin-message");
  button.disabled = true;
  button.textContent = "Paying all…";
  try {
    const result = await api("/api/events/admin/attendance/confirm-all", {
      method: "POST",
      body: JSON.stringify({ eventId: selectedAdminEvent.id }),
    });
    message.textContent = `Attendance payout complete: ${result.paid || 0} paid, ${result.duplicates || 0} already paid, ${result.failed || 0} failed · ${Number(result.payoutAmount || 0).toLocaleString()} VC processed.`;
    await Promise.all([loadAdminAttendance(), loadAdminRewards(), loadMyEventRewards(), loadMyAttendance()]);
    renderEvents();
  } catch (error) {
    message.textContent = error.message || "Could not confirm all attendees.";
  } finally {
    button.textContent = "✓ Confirm all attendees";
    renderSelectedAdminEvent();
  }
});

document.getElementById("event-bonus-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedAdminEvent) return;
  const steamId = document.getElementById("event-bonus-steam").value.trim();
  const label = document.getElementById("event-bonus-label").value.trim();
  const amount = Number(document.getElementById("event-bonus-amount").value);
  const applySupporterMultiplier = document.getElementById("event-bonus-multiplier").checked;
  const submit = document.getElementById("event-bonus-submit");
  const message = document.getElementById("event-admin-message");

  if (!/^\d{17}$/.test(steamId) || !label || !Number.isSafeInteger(amount) || amount <= 0) {
    message.textContent = "Enter a valid Steam ID, bonus reason and whole-number Valley Coin amount.";
    return;
  }

  const multiplierText = applySupporterMultiplier ? " The event supporter multiplier WILL be applied." : " Supporter multiplier will NOT be applied.";
  if (!confirm(`Pay ${amount.toLocaleString()} VC for "${label}" to ${playerName(steamId)}?${multiplierText}`)) return;

  submit.disabled = true;
  submit.textContent = "Paying…";
  try {
    const bonusId = globalThis.crypto?.randomUUID?.() || `bonus-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const result = await api("/api/events/admin/bonus", {
      method: "POST",
      body: JSON.stringify({
        steamId,
        eventId: selectedAdminEvent.id,
        eventTitle: selectedAdminEvent.title,
        amount,
        label,
        bonusId,
        applySupporterMultiplier,
      }),
    });
    message.textContent = `${label}: +${Number(result.payoutAmount || 0).toLocaleString()} VC paid to ${playerName(steamId)}.`;
    document.getElementById("event-bonus-amount").value = "";
    await Promise.all([loadAdminRewards(), loadMyEventRewards()]);
  } catch (error) {
    message.textContent = error.message || "Could not issue event bonus.";
  } finally {
    submit.textContent = "Pay bonus →";
    renderSelectedAdminEvent();
  }
});

async function init() {
  try {
    me = await window.HDS.loadMe();
  } catch {
    me = { loggedIn: false, user: null };
  }

  await loadMyAttendance();

  try {
    const data = await api("/api/events");
    events = data.events || [];
    renderCalendar();
    renderEvents();
    if (data.configured && data.stale) {
      document.getElementById("event-list").insertAdjacentHTML("afterbegin", '<div class="map-history-note">Discord event sync is temporarily stale. Showing the last successful HerbyBot snapshot.</div>');
    }
    if (!data.configured) {
      document.getElementById("event-list").innerHTML = '<div class="empty-roster"><strong>Discord event calendar is not connected on this service</strong><span>Attendance rewards remain available once an event is synced.</span></div>';
    }
  } catch (error) {
    console.error("Failed to load Discord events", error);
    document.getElementById("event-list").innerHTML = '<div class="empty-roster"><strong>Events are temporarily unavailable</strong><span>The event reward ledger remains available.</span></div>';
    renderCalendar();
  }

  await Promise.all([loadMyEventRewards(), loadAdminRewards()]);
}

document.getElementById("calendar-previous")?.addEventListener("click", () => {
  visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1);
  renderCalendar();
});

document.getElementById("calendar-next")?.addEventListener("click", () => {
  visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1);
  renderCalendar();
});

init();
