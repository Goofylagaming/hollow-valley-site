const { api, escapeHtml } = window.HDS;

const REFRESH_INTERVAL_MS = 30_000;

let events = [];
let visibleMonth = new Date();
let refreshTimer = null;
visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);

function dateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatEventTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatSyncTime(value) {
  if (!value) return "Waiting for first sync";
  return `Last synced ${new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value))}`;
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
    const eventLinks = dayEvents
      .slice(0, 2)
      .map((event) => `<a href="${escapeHtml(event.url)}" target="_blank" rel="noopener" class="calendar-event" title="${escapeHtml(event.title)}">${escapeHtml(event.title)}</a>`)
      .join("");

    cells.push(`
      <div class="calendar-day ${dateKey(date) === today ? "today" : ""}">
        <b>${day}</b>
        ${eventLinks}
        ${dayEvents.length > 2 ? `<small>+${dayEvents.length - 2} more</small>` : ""}
      </div>`
    );
  }

  grid.innerHTML = cells.join("");
}

function renderEvents() {
  const list = document.getElementById("event-list");
  const now = Date.now();
  const upcoming = events
    .filter((event) => new Date(event.endTime || event.startTime).getTime() >= now)
    .slice(0, 20);

  if (!upcoming.length) {
    list.innerHTML = '<div class="empty-roster"><strong>No upcoming events</strong><span>Create a Scheduled Event in Discord and it will appear here automatically.</span></div>';
    return;
  }

  list.innerHTML = upcoming.map((event) => {
    const location = event.location ? `📍 ${escapeHtml(event.location)}` : "Discord event";
    const attendees = Number(event.attendees || 0);
    return `<article class="event-card">
      <div>
        <small>${formatEventTime(event.startTime)}</small>
        <h3>${escapeHtml(event.title)}</h3>
        ${event.description ? `<p>${escapeHtml(event.description)}</p>` : ""}
        <span>${location}${attendees ? ` · ${attendees} interested` : ""}</span>
      </div>
      <a class="small-button" href="${escapeHtml(event.url)}" target="_blank" rel="noopener">View in Discord</a>
    </article>`;
  }).join("");
}

function setSyncState({ ok, configured = true, syncedAt = null, message = null } = {}) {
  const state = document.getElementById("event-sync-state");
  const time = document.getElementById("event-sync-time");
  const strip = state?.closest(".event-sync-strip");
  if (!state || !time || !strip) return;

  strip.classList.toggle("offline", !ok);
  strip.classList.toggle("online", Boolean(ok));

  if (!configured) {
    state.textContent = "Discord event sync not configured";
    time.textContent = "Set the Discord bot token and guild ID";
    return;
  }

  state.textContent = ok ? "Discord events synced" : (message || "Discord sync temporarily unavailable");
  time.textContent = syncedAt ? formatSyncTime(syncedAt) : "Waiting for next sync";
}

async function refreshEvents({ initial = false } = {}) {
  clearTimeout(refreshTimer);

  try {
    const data = await api("/api/events");
    events = Array.isArray(data.events) ? data.events : [];
    renderCalendar();
    renderEvents();
    setSyncState({
      ok: Boolean(data.configured),
      configured: Boolean(data.configured),
      syncedAt: data.syncedAt,
    });

    if (!data.configured && initial) {
      document.getElementById("event-list").innerHTML =
        '<div class="empty-roster"><strong>Discord events are not configured yet</strong><span>Once Herbybot is connected, Scheduled Events will appear here automatically.</span></div>';
    }
  } catch (error) {
    console.error("Failed to load Discord events", error);
    setSyncState({ ok: false, message: "Discord sync temporarily unavailable" });

    if (initial && !events.length) {
      document.getElementById("event-list").innerHTML =
        '<div class="empty-roster"><strong>Events are temporarily unavailable</strong><span>The website will retry automatically.</span></div>';
      renderCalendar();
    }
  } finally {
    refreshTimer = setTimeout(() => refreshEvents(), REFRESH_INTERVAL_MS);
  }
}

document.getElementById("calendar-previous").addEventListener("click", () => {
  visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1);
  renderCalendar();
});

document.getElementById("calendar-next").addEventListener("click", () => {
  visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1);
  renderCalendar();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshEvents();
});

refreshEvents({ initial: true });
