const { api, escapeHtml } = window.HDS;

let events = [];
let visibleMonth = new Date();
visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);

function dateKey(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function formatEventTime(value) {
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function eventsOn(date) {
  const key = dateKey(date);
  return events.filter((event) => dateKey(new Date(event.startTime)) === key);
}

function renderCalendar() {
  document.getElementById("calendar-title").textContent = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(visibleMonth);
  const grid = document.getElementById("calendar-grid");
  const month = visibleMonth.getMonth();
  const year = visibleMonth.getFullYear();
  const firstOffset = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = dateKey(new Date());
  const cells = [];

  for (let i = 0; i < firstOffset; i++) cells.push('<div class="calendar-day muted"></div>');
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const dayEvents = eventsOn(date);
    cells.push(`<div class="calendar-day ${dateKey(date) === today ? "today" : ""}"><b>${day}</b>${dayEvents.slice(0, 2).map((event) => `<a href="${event.url}" target="_blank" rel="noopener" class="calendar-event" title="${escapeHtml(event.title)}">${escapeHtml(event.title)}</a>`).join("")}${dayEvents.length > 2 ? `<small>+${dayEvents.length - 2} more</small>` : ""}</div>`);
  }
  grid.innerHTML = cells.join("");
}

function renderEvents() {
  const list = document.getElementById("event-list");
  const upcoming = events.filter((event) => new Date(event.startTime) >= new Date()).slice(0, 12);
  if (!upcoming.length) {
    list.innerHTML = '<div class="empty-roster"><strong>No upcoming events</strong><span>New Discord events will appear here automatically.</span></div>';
    return;
  }
  list.innerHTML = upcoming.map((event) => `<article class="event-card"><div><small>${formatEventTime(event.startTime)}</small><h3>${escapeHtml(event.title)}</h3>${event.description ? `<p>${escapeHtml(event.description)}</p>` : ""}<span>${event.location ? `?? ${escapeHtml(event.location)}` : "Discord event"}${event.attendees ? ` ? ${event.attendees} interested` : ""}</span></div><a class="small-button" href="${event.url}" target="_blank" rel="noopener">View in Discord</a></article>`).join("");
}

async function init() {
  try {
    const data = await api("/api/events");
    events = data.events || [];
    renderCalendar();
    renderEvents();
    if (!data.configured) {
      document.getElementById("event-list").innerHTML = '<div class="empty-roster"><strong>Discord events are being connected</strong><span>Scheduled events from Discord will appear here shortly.</span></div>';
    }
  } catch (error) {
    console.error("Failed to load Discord events", error);
    document.getElementById("event-list").innerHTML = '<div class="empty-roster"><strong>Events are temporarily unavailable</strong><span>Please try again shortly.</span></div>';
    renderCalendar();
  }
}

document.getElementById("calendar-previous").addEventListener("click", () => { visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1); renderCalendar(); });
document.getElementById("calendar-next").addEventListener("click", () => { visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1); renderCalendar(); });
init();
