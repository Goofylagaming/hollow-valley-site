const { api } = window.HDS;

let currentEvent = null;

function text(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? "—";
}

function parseDate(value) {
  if (!value) return null;
  const raw = String(value);
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(" ", "T")}Z`
    : raw;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = parseDate(value);
  return date ? date.toLocaleString() : "Not set";
}

function formatDateInput(value) {
  const date = parseDate(value);
  if (!date) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function inputDateIso(id) {
  const raw = document.getElementById(id)?.value;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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
    when.textContent = formatDate(item.created_at);
    row.append(main, when);
    target.append(row);
  }
}

function renderPresence(presence) {
  const target = document.getElementById("tw-admin-presence");
  const count = document.getElementById("tw-admin-presence-count");
  if (!target || !count) return;

  if (!presence?.tracking) {
    count.textContent = "Not tracked";
    count.className = "tw-status";
    text("tw-admin-presence-heading", "Territory geometry unavailable");
    target.innerHTML = '<div class="tw-empty">This event does not currently have usable Battlefield and Claim Zone geometry.</div>';
    return;
  }

  text("tw-admin-presence-heading", `${presence.region || "Territory"} Battlefield / Claim Zone`);
  if (!presence.serverOnline) {
    count.textContent = "Server offline";
    count.className = "tw-status";
    target.innerHTML = '<div class="tw-empty">The Isle server is offline or the live tracker is unavailable.</div>';
    return;
  }

  const players = Array.isArray(presence.players) ? presence.players : [];
  const battlefieldCount = Number(presence.playerCount ?? players.length) || 0;
  const claimCount = Number(presence.claimCount ?? players.filter((player) => player.inClaim).length) || 0;
  const eligibleClaim = Number(presence.eligibleClaimCount ?? players.filter((player) => player.lineupActive && player.inClaim).length) || 0;
  count.textContent = `${eligibleClaim} eligible claim · ${claimCount} claim · ${battlefieldCount} battlefield`;
  count.className = `tw-status ${battlefieldCount ? "live" : ""}`;
  target.replaceChildren();
  if (!players.length) {
    target.innerHTML = '<div class="tw-empty">No live players detected inside the Battlefield.</div>';
    return;
  }

  const orderedPlayers = [...players].sort((a, b) => Number(Boolean(b.inClaim)) - Number(Boolean(a.inClaim)) || String(a.name || "").localeCompare(String(b.name || "")));
  for (const player of orderedPlayers) {
    const row = document.createElement("div");
    row.className = "tw-list-row";
    const main = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = player.name || "Unknown player";
    const detail = document.createElement("span");
    const group = player.groupName ? `${player.groupName}${player.groupTag ? ` [${player.groupTag}]` : ""}` : "No permanent Group";
    const zone = player.inClaim
      ? "CLAIM ZONE"
      : `Battlefield${Number.isFinite(Number(player.distanceMetres)) ? ` · ${Math.round(Number(player.distanceMetres))}m from claim centre` : ""}`;
    const eligibility = player.systemDefender
      ? "Admin defender"
      : player.lineupActive
        ? "Eligible lineup"
        : "Not active lineup";
    detail.textContent = [
      zone,
      player.species || "Unknown species",
      player.isPrime ? "Prime" : null,
      group,
      eligibility,
      player.steamId || null,
    ].filter(Boolean).join(" · ");
    main.append(strong, detail);
    row.append(main);
    target.append(row);
  }
}

function renderRegistrations(registrations) {
  const target = document.getElementById("tw-admin-registrations");
  const count = document.getElementById("tw-admin-registration-count");
  if (!target || !count) return;

  const entries = Array.isArray(registrations) ? registrations : [];
  count.textContent = `${entries.length} Group${entries.length === 1 ? "" : "s"}`;
  count.className = `tw-status ${entries.length ? "live" : ""}`;
  target.replaceChildren();

  if (!entries.length) {
    target.innerHTML = '<div class="tw-empty">No Groups are registered for the current event.</div>';
    return;
  }

  for (const registration of entries) {
    const row = document.createElement("div");
    row.className = "tw-list-row";
    const main = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = `${registration.group_name || "Group"}${registration.group_tag ? ` [${registration.group_tag}]` : ""}`;
    const detail = document.createElement("span");
    detail.textContent = `${String(registration.status || "registered").toUpperCase()} · Registered ${formatDate(registration.registered_at)}`;
    main.append(strong, detail);

    const lineup = document.createElement("b");
    const lineupCount = Number(registration.lineup_count || 0);
    lineup.className = `tw-lineup-badge ${lineupCount ? "active" : ""}`;
    lineup.textContent = `${lineupCount} / 6 FIGHTERS`;
    row.append(main, lineup);
    target.append(row);
  }
}

function renderAttackState(event, attack) {
  const score = Math.max(-100, Math.min(100, Number(event?.control_score ?? -100)));
  text("tw-admin-control-score", `${score > 0 ? "+" : ""}${Math.round(score * 10) / 10}`);

  const protectionUntil = parseDate(event?.protection_until);
  text(
    "tw-admin-protection",
    protectionUntil && protectionUntil.getTime() > Date.now()
      ? `Until ${protectionUntil.toLocaleTimeString()}`
      : "None"
  );

  if (!attack) {
    text("tw-admin-attack-status", "None");
    text(
      "tw-admin-attack-detail",
      event?.status === "live"
        ? "No Group is currently challenging this territory."
        : "Attack declarations require a live event."
    );
    return;
  }

  const attacker = `${attack.attacker_name || "Challenger"}${attack.attacker_tag ? ` [${attack.attacker_tag}]` : ""}`;
  const defender = `${attack.defender_name || event?.owner_name || "Owner"}${attack.defender_tag ? ` [${attack.defender_tag}]` : ""}`;
  const status = String(attack.status || "warning");
  text("tw-admin-attack-status", status === "warning" ? "Warning" : "Active");

  if (status === "warning") {
    text("tw-admin-attack-detail", `${attacker} declared an attack on ${defender}. Contest opens ${formatDate(attack.starts_at)}.`);
    return;
  }

  const contestStarted = parseDate(attack.contest_started_at);
  if (!contestStarted) {
    text("tw-admin-attack-detail", `${attacker} is active against ${defender}, but two eligible attackers have not yet held the Claim Zone continuously.`);
    return;
  }

  const armsAt = new Date(contestStarted.getTime() + (2 * 60 * 1000));
  text(
    "tw-admin-attack-detail",
    armsAt.getTime() > Date.now()
      ? `${attacker} has started the two-minute Claim Zone hold against ${defender}. Control movement unlocks ${armsAt.toLocaleString()}.`
      : `${attacker} has armed the contest against ${defender}. Eligible Claim Zone presence can now move territory control.`
  );
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
    renderAttackState(data.event, data.attack);
    renderPresence(data.presence);
    renderRegistrations(data.registrations);
  } catch (error) {
    setMessage(error.message || "Could not load Territory Wars admin state.", true);
  }
}

async function refreshPresence() {
  try {
    const data = await api("/api/territory-wars/admin/state");
    currentEvent = data.event || currentEvent;
    renderAttackState(data.event, data.attack);
    renderPresence(data.presence);
    renderRegistrations(data.registrations);
  } catch {
    // Keep the most recent live state without disrupting admin edits.
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
    startsAt: inputDateIso("tw-admin-starts"),
    endsAt: inputDateIso("tw-admin-ends"),
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
    renderAttackState(data.event, null);
    renderRegistrations(data.registrations);
    await refreshPresence();
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
    await refreshPresence();
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
    let data = await api(`/api/territory-wars/admin/${path}`, {
      method: "POST",
      body: JSON.stringify({ id: currentEvent.id, ...payload }),
    });

    if (path === "reset") {
      data = await api("/api/territory-wars/admin/status", {
        method: "POST",
        body: JSON.stringify({ id: currentEvent.id, status: "paused" }),
      });
    }

    renderEvent(data.event, data.log || []);
    await refreshPresence();
    setMessage(path === "reset" ? "Territory reset and paused." : "Territory War updated.");
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
document.getElementById("tw-admin-reset")?.addEventListener("click", () => postAction("reset", "Reset this territory to current-owner control and pause the event?"));
document.getElementById("tw-admin-remove-challenger")?.addEventListener("click", () => postAction("remove-challenger", "Remove the current challenger and reset control?"));
document.getElementById("tw-admin-owner-win")?.addEventListener("click", () => postAction("force-capture", "Force the current owner to retain this territory?", { winner: "owner" }));
document.getElementById("tw-admin-challenger-win")?.addEventListener("click", () => postAction("force-capture", "Force the challenger to capture this territory?", { winner: "challenger" }));

refreshState();
setInterval(refreshPresence, 10000);
