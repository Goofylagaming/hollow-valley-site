const { api } = window.HDS;

let currentEvent = null;

function text(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? "—";
}

function formatDateInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function setMessage(message, error = false) {
  const el = document.getElementById("tw-admin-message");
  if (!el) return;
  el.className = `tw-inline-message${error ? " error" : ""}`;
  el.textContent = message || "";
}

function setStatusElement(id, status) {
  const el = document.getElementById(id);
  if (!el) return;
  const value = String(status || "scheduled").toLowerCase();
  el.textContent = value[0]?.toUpperCase() + value.slice(1);
  el.className = `tw-status ${value}`;
}

function renderLog(log) {
  const target = document.getElementById("tw-admin-log");
  if (!target) return;
  target.replaceChildren();
  if (!Array.isArray(log) || !log.length) {
    target.innerHTML = '<div class="tw-empty">No Territory War activity yet.</div>';
    return;
  }
  for (const item of log) {
    const row = document.createElement("div");
    row.className = "tw-list-row";
    const main = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = item.message || "Territory updated";
    const detail = document.createElement("span");
    detail.textContent = String(item.kind || "update").replace(/-/g, " ");
    main.append(strong, detail);
    const when = document.createElement("span");
    when.textContent = item.created_at ? new Date(item.created_at).toLocaleString() : "";
    row.append(main, when);
    target.append(row);
  }
}

function populateForm(event) {
  if (!event) return;
  document.getElementById("tw-admin-name").value = event.name || "";
  document.getElementById("tw-admin-territory").value = event.territory_name || "South Plains";
  document.getElementById("tw-admin-key").value = event.territory_key || "south-plains";
  document.getElementById("tw-admin-owner").value = event.owner_name || "Admin";
  document.getElementById("tw-admin-challenger").value = event.challenger_name || "";
  document.getElementById("tw-admin-starts").value = formatDateInput(event.starts_at);
  document.getElementById("tw-admin-ends").value = formatDateInput(event.ends_at);
}

function renderEvent(event, log = []) {
  currentEvent = event || null;
  const owner = Math.max(0, Math.min(100, Number(event?.owner_control ?? 100)));
  const challenger = Math.max(0, Math.min(100, Number(event?.challenger_control ?? 0)));
  const status = event?.status || "scheduled";

  setStatusElement("tw-admin-status", status);
  setStatusElement("tw-admin-current-status", status);
  text("tw-admin-territory-heading", event?.territory_name || "South Plains");
  text("tw-admin-current-owner", event?.owner_name || "Admin");
  text("tw-admin-current-challenger", event?.challenger_name || "Open");
  text("tw-admin-owner-percent", `${owner}%`);
  text("tw-admin-challenger-percent", `${challenger}%`);
  text("tw-admin-control-value", `${owner}%`);

  const slider = document.getElementById("tw-admin-control");
  if (slider) slider.value = String(owner);
  const ownerBar = document.getElementById("tw-admin-owner-bar");
  const challengerBar = document.getElementById("tw-admin-challenger-bar");
  if (ownerBar) ownerBar.style.width = `${owner}%`;
  if (challengerBar) challengerBar.style.width = `${challenger}%`;

  if (event) populateForm(event);
  renderLog(log);
}

async function refreshState() {
  try {
    const data = await api("/api/territory-wars/admin/state");
    renderEvent(data.event, data.log);
  } catch (error) {
    setMessage(error.message || "Could not load Territory Wars admin state.", true);
  }
}

async function saveEvent(event) {
  event.preventDefault();
  const payload = {
    id: currentEvent?.id || undefined,
    name: document.getElementById("tw-admin-name").value,
    territoryName: document.getElementById("tw-admin-territory").value,
    territoryKey: document.getElementById("tw-admin-key").value,
    ownerName: document.getElementById("tw-admin-owner").value,
    challengerName: document.getElementById("tw-admin-challenger").value,
    startsAt: document.getElementById("tw-admin-starts").value || null,
    endsAt: document.getElementById("tw-admin-ends").value || null,
  };

  const button = document.getElementById("tw-admin-save");
  if (button) button.disabled = true;
  setMessage("Saving event…");
  try {
    const data = await api("/api/territory-wars/admin/event", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    renderEvent(data.event, data.log);
    setMessage("Territory War saved.");
  } catch (error) {
    setMessage(error.message || "Could not save event.", true);
  } finally {
    if (button) button.disabled = false;
  }
}

async function setEventStatus(status) {
  if (!currentEvent?.id) return setMessage("Save an event first.", true);
  setMessage(`Setting event ${status}…`);
  try {
    const data = await api("/api/territory-wars/admin/status", {
      method: "POST",
      body: JSON.stringify({ id: currentEvent.id, status }),
    });
    renderEvent(data.event, data.log);
    setMessage(`Event is now ${status}.`);
  } catch (error) {
    setMessage(error.message || "Could not update event status.", true);
  }
}

async function applyControl() {
  if (!currentEvent?.id) return setMessage("Save an event first.", true);
  const ownerControl = Number(document.getElementById("tw-admin-control").value);
  try {
    const data = await api("/api/territory-wars/admin/control", {
      method: "POST",
      body: JSON.stringify({ id: currentEvent.id, ownerControl }),
    });
    currentEvent = data.event;
    await refreshState();
    setMessage(`Control set to ${ownerControl}% owner / ${100 - ownerControl}% challenger.`);
  } catch (error) {
    setMessage(error.message || "Could not update territory control.", true);
  }
}

async function postAction(path, confirmText, payload = {}) {
  if (!currentEvent?.id) return setMessage("Save an event first.", true);
  if (confirmText && !confirm(confirmText)) return;
  try {
    const data = await api(`/api/territory-wars/admin/${path}`, {
      method: "POST",
      body: JSON.stringify({ id: currentEvent.id, ...payload }),
    });
    renderEvent(data.event, data.log || []);
    setMessage("Territory War updated.");
  } catch (error) {
    setMessage(error.message || "Territory War action failed.", true);
  }
}

document.getElementById("tw-admin-event-form")?.addEventListener("submit", saveEvent);
document.querySelectorAll("[data-status]").forEach((button) => {
  button.addEventListener("click", () => setEventStatus(button.dataset.status));
});

document.getElementById("tw-admin-control")?.addEventListener("input", (event) => {
  text("tw-admin-control-value", `${event.currentTarget.value}%`);
});

document.getElementById("tw-admin-apply-control")?.addEventListener("click", applyControl);
document.getElementById("tw-admin-reset")?.addEventListener("click", () => postAction("reset", "Reset this territory to 100% current-owner control?"));
document.getElementById("tw-admin-remove-challenger")?.addEventListener("click", () => postAction("remove-challenger", "Remove the current challenger and reset control?"));
document.getElementById("tw-admin-owner-win")?.addEventListener("click", () => postAction("force-capture", "Force the current owner to retain this territory?", { winner: "owner" }));
document.getElementById("tw-admin-challenger-win")?.addEventListener("click", () => postAction("force-capture", "Force the challenger to capture this territory?", { winner: "challenger" }));

refreshState();
