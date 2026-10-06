const { api, loadMe } = window.HDS;

let currentPlayerState = null;

function text(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? "—";
}

function setHidden(id, hidden) {
  const el = document.getElementById(id);
  if (el) el.hidden = Boolean(hidden);
}

function setMessage(id, message, error = false) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `tw-inline-message${error ? " error" : ""}`;
  el.textContent = message || "";
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

function formatRole(role) {
  const value = String(role || "member");
  return value[0].toUpperCase() + value.slice(1);
}

function setStatus(status) {
  const el = document.getElementById("tw-status");
  if (!el) return;
  const value = String(status || "scheduled").toLowerCase();
  el.textContent = value[0]?.toUpperCase() + value.slice(1);
  el.className = `tw-status ${value}`;
}

function renderEvent(event) {
  const current = event || {
    territory_name: "South Plains",
    name: "No Territory War event is scheduled yet.",
    owner_name: "Admin",
    challenger_name: null,
    owner_control: 100,
    challenger_control: 0,
    control_score: -100,
    status: "scheduled",
    starts_at: null,
    ends_at: null,
  };

  const owner = Math.max(0, Math.min(100, Number(current.owner_control) || 0));
  const challenger = Math.max(0, Math.min(100, Number(current.challenger_control) || 0));
  const score = Math.max(-100, Math.min(100, Number(current.control_score ?? -100)));

  text("tw-territory-name", current.territory_name || "South Plains");
  text("tw-event-name", current.name || "Territory War");
  text("tw-owner-name", current.owner_name || "Admin");
  text("tw-challenger-name", current.challenger_name || "Open");
  text("tw-owner-percent", `${owner}%`);
  text("tw-challenger-percent", `${challenger}%`);
  text("tw-control-score", `${score > 0 ? "+" : ""}${Math.round(score * 10) / 10}`);
  text("tw-starts", formatDate(current.starts_at));
  text("tw-ends", formatDate(current.ends_at));
  setStatus(current.status);

  const ownerBar = document.getElementById("tw-owner-bar");
  const challengerBar = document.getElementById("tw-challenger-bar");
  if (ownerBar) ownerBar.style.width = `${owner}%`;
  if (challengerBar) challengerBar.style.width = `${challenger}%`;
}

function renderPresence(presence) {
  if (!presence?.tracking) {
    text("tw-presence", "Territory geometry unavailable");
    return;
  }
  if (!presence.serverOnline) {
    text("tw-presence", "Server offline");
    return;
  }
  const battlefield = Number(presence.playerCount || 0);
  const claim = Number(presence.claimCount || 0);
  const eligibleClaim = Number(presence.eligibleClaimCount || 0);
  const prefix = presence.simulated ? "Preview sim · " : "";
  text("tw-presence", `${prefix}${eligibleClaim} eligible claim · ${claim} claim · ${battlefield} battlefield`);
}

function renderLog(log) {
  const target = document.getElementById("tw-event-log");
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
    const time = document.createElement("time");
    time.textContent = formatDate(item.created_at);
    row.append(main, time);
    target.append(row);
  }
}

function renderLeaderboard(entries) {
  const target = document.getElementById("tw-leaderboard");
  if (!target) return;
  target.replaceChildren();
  if (!Array.isArray(entries) || !entries.length) {
    target.innerHTML = '<div class="tw-empty">No group results recorded yet.</div>';
    return;
  }
  entries.forEach((group, index) => {
    const row = document.createElement("div");
    row.className = "tw-list-row";
    const main = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = `${index + 1}. ${group.name}${group.tag ? ` [${group.tag}]` : ""}`;
    const detail = document.createElement("span");
    detail.textContent = `${Number(group.wins || 0)} wins · ${Number(group.captures || 0)} captures · ${Number(group.kills || 0)} kills`;
    main.append(strong, detail);
    const rank = document.createElement("b");
    rank.className = "tw-rank";
    rank.textContent = `#${index + 1}`;
    row.append(main, rank);
    target.append(row);
  });
}

function renderInvites(invites) {
  const target = document.getElementById("tw-group-invites");
  if (!target) return;
  target.replaceChildren();
  if (!Array.isArray(invites) || !invites.length) {
    target.innerHTML = '<div class="tw-empty">No pending Group invites.</div>';
    return;
  }

  for (const invite of invites) {
    const row = document.createElement("div");
    row.className = "tw-list-row";
    const main = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = `${invite.group_name || "Group"}${invite.group_tag ? ` [${invite.group_tag}]` : ""}`;
    const detail = document.createElement("span");
    detail.textContent = `Invited by ${invite.invited_by || "Group staff"} · ${formatDate(invite.created_at)}`;
    main.append(strong, detail);

    const accept = document.createElement("button");
    accept.className = "tw-button primary";
    accept.type = "button";
    accept.textContent = "Accept";
    accept.addEventListener("click", () => acceptGroupInvite(invite.id, accept));
    row.append(main, accept);
    target.append(row);
  }
}

function renderGroup(data) {
  const group = data?.group;
  const steamLinked = Boolean(data?.player?.steamId);
  const status = document.getElementById("tw-group-status");

  setHidden("tw-login-state", steamLinked);
  if (!steamLinked) {
    setHidden("tw-group-create-state", true);
    setHidden("tw-group-current-state", true);
    if (status) {
      status.textContent = "Steam required";
      status.className = "tw-status";
    }
    const login = document.getElementById("tw-login-state");
    if (login) login.textContent = "Link or sign in with the Steam account you use on Hollow Valley before creating or joining a permanent Group.";
    return;
  }

  if (!group) {
    setHidden("tw-group-create-state", false);
    setHidden("tw-group-current-state", true);
    if (status) {
      status.textContent = "No Group";
      status.className = "tw-status";
    }
    renderInvites(data.invites);
    return;
  }

  setHidden("tw-group-create-state", true);
  setHidden("tw-group-current-state", false);
  if (status) {
    status.textContent = group.tag ? `[${group.tag}]` : "Grouped";
    status.className = "tw-status live";
  }

  text("tw-group-name", `${group.name}${group.tag ? ` [${group.tag}]` : ""}`);
  text("tw-group-role", formatRole(group.role));
  text("tw-group-wins", Number(group.wins || 0));
  text("tw-group-captures", Number(group.captures || 0));
  text("tw-group-kills", Number(group.kills || 0));

  const roster = document.getElementById("tw-group-roster");
  if (roster) {
    roster.replaceChildren();
    for (const member of data.roster || []) {
      const row = document.createElement("div");
      row.className = "tw-list-row";
      const main = document.createElement("div");
      const strong = document.createElement("strong");
      strong.textContent = member.username || "Player";
      const detail = document.createElement("span");
      detail.textContent = [formatRole(member.role), member.steam_id ? "Steam linked" : "Steam unlinked", member.discord_id ? "Discord linked" : "Discord unlinked"].join(" · ");
      main.append(strong, detail);
      row.append(main);
      roster.append(row);
    }
  }

  const canInvite = ["leader", "officer"].includes(String(group.role));
  setHidden("tw-group-invite-form", !canInvite);
}

function updateLineupCount() {
  const checked = document.querySelectorAll('.tw-lineup-check:checked').length;
  const cap = Number(currentPlayerState?.lineupCap || 6);
  text("tw-lineup-count", `${checked} / ${cap}`);
  document.querySelectorAll(".tw-lineup-check:not(:checked)").forEach((checkbox) => {
    checkbox.disabled = checked >= cap || checkbox.dataset.editable !== "true";
  });
  document.querySelectorAll(".tw-lineup-check:checked").forEach((checkbox) => {
    checkbox.disabled = checkbox.dataset.editable !== "true";
  });
}

function renderLineup(data) {
  const target = document.getElementById("tw-lineup-list");
  if (!target) return;
  target.replaceChildren();

  const group = data.group;
  const event = data.event;
  const canManage = ["leader", "officer"].includes(String(group?.role));
  const selectedByUser = new Map((data.lineup || []).map((entry) => [Number(entry.user_id), entry]));
  const roster = Array.isArray(data.roster) ? data.roster : [];

  if (!roster.length) {
    target.innerHTML = '<div class="tw-empty">Your Group has no eligible members yet.</div>';
    setHidden("tw-lineup-actions", true);
    return;
  }

  const now = Date.now();
  for (const member of roster) {
    const selected = selectedByUser.get(Number(member.id));
    const activeAt = parseDate(selected?.active_from);
    const pending = Boolean(activeAt && activeAt.getTime() > now);
    const steamLinked = /^\d{17}$/.test(String(member.steam_id || ""));

    const label = document.createElement("label");
    label.className = `tw-lineup-row${selected ? " is-selected" : ""}${pending ? " is-pending" : ""}`;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "tw-lineup-check";
    checkbox.value = String(member.id);
    checkbox.checked = Boolean(selected);
    checkbox.dataset.editable = String(canManage && steamLinked && event?.status !== "ended");
    checkbox.disabled = checkbox.dataset.editable !== "true";
    checkbox.addEventListener("change", updateLineupCount);

    const info = document.createElement("span");
    info.className = "tw-lineup-info";
    const name = document.createElement("strong");
    name.textContent = member.username || "Player";
    const detail = document.createElement("span");
    const state = selected
      ? pending
        ? `Substitution activates ${formatDate(selected.active_from)}`
        : "Active lineup fighter"
      : steamLinked
        ? "Available"
        : "Steam link required";
    detail.textContent = `${formatRole(member.role)} · ${state}`;
    info.append(name, detail);

    const badge = document.createElement("b");
    badge.className = `tw-lineup-badge${selected ? pending ? " pending" : " active" : ""}`;
    badge.textContent = selected ? pending ? "PENDING" : "SELECTED" : "—";

    label.append(checkbox, info, badge);
    target.append(label);
  }

  setHidden("tw-lineup-actions", !canManage || event?.status === "ended");
  updateLineupCount();
}

function activeLineupCount(data) {
  const now = Date.now();
  return (data?.lineup || []).filter((member) => {
    const activeAt = parseDate(member.active_from);
    return activeAt && activeAt.getTime() <= now;
  }).length;
}

function renderAttack(data) {
  const group = data?.group;
  const event = data?.event;
  const registration = data?.eventRegistration;
  const attack = data?.attack;
  const button = document.getElementById("tw-declare-attack");

  if (!group || !event || !registration) {
    setHidden("tw-attack-state", true);
    return;
  }
  setHidden("tw-attack-state", false);
  if (button) button.hidden = true;
  setMessage("tw-attack-message", "");

  if (attack) {
    const attackerName = `${attack.attacker_name || "Challenger"}${attack.attacker_tag ? ` [${attack.attacker_tag}]` : ""}`;
    const defenderName = `${attack.defender_name || event.owner_name || "Owner"}${attack.defender_tag ? ` [${attack.defender_tag}]` : ""}`;
    text("tw-attack-title", `${attackerName} attacking ${event.territory_name || "territory"}`);
    if (attack.status === "warning") {
      text("tw-attack-detail", `Five-minute warning active against ${defenderName} · attack begins ${formatDate(attack.starts_at)}.`);
    } else if (attack.contest_started_at) {
      const armedAt = parseDate(attack.contest_started_at);
      const eligibleAt = armedAt ? new Date(armedAt.getTime() + (2 * 60 * 1000)) : null;
      text("tw-attack-detail", eligibleAt && eligibleAt.getTime() > Date.now()
        ? `Attack active · two-minute Claim Zone hold completes ${eligibleAt.toLocaleString()}.`
        : "Attack active · contest is armed and eligible Claim Zone presence can move territory control.");
    } else {
      text("tw-attack-detail", "Attack active · at least two eligible lineup fighters must hold the Claim Zone continuously for two minutes.");
    }
    return;
  }

  const protection = parseDate(event.protection_until);
  const ownsTerritory = String(event.owner_name || "").toLowerCase() === String(group.name || "").toLowerCase();
  const canDeclare = ["leader", "officer"].includes(String(group.role));
  const activeFighters = activeLineupCount(data);

  text("tw-attack-title", "No active attack");
  if (event.status !== "live") {
    text("tw-attack-detail", "Attack declarations open when the event is live.");
  } else if (protection && protection.getTime() > Date.now()) {
    text("tw-attack-detail", `Territory is protected after capture until ${protection.toLocaleString()}.`);
  } else if (ownsTerritory) {
    text("tw-attack-detail", "Your Group currently owns this territory. Hold the Claim Zone and defend the Battlefield from challengers.");
  } else if (activeFighters < 2) {
    text("tw-attack-detail", `Your lineup needs at least two active fighters before an attack can be declared. Active now: ${activeFighters}.`);
  } else if (!canDeclare) {
    text("tw-attack-detail", "A Group Leader or Officer can declare the attack.");
  } else {
    text("tw-attack-detail", "Declare the attack to start the five-minute server warning before the Claim Zone can be contested.");
    if (button) button.hidden = false;
  }
}

function renderEventEntry(data) {
  const group = data?.group;
  const event = data?.event;
  const registration = data?.eventRegistration;
  const status = document.getElementById("tw-event-entry-status");
  const empty = document.getElementById("tw-event-entry-empty");
  const registerButton = document.getElementById("tw-event-register-group");

  if (!group) {
    setHidden("tw-event-entry-state", true);
    if (empty) {
      empty.hidden = false;
      empty.textContent = "Create or join a permanent Group to enter a Territory War.";
    }
    if (status) {
      status.textContent = "Group required";
      status.className = "tw-status";
    }
    return;
  }

  if (!event) {
    setHidden("tw-event-entry-state", true);
    if (empty) {
      empty.hidden = false;
      empty.textContent = "Your Group is ready. No Territory War event is currently scheduled.";
    }
    if (status) {
      status.textContent = "No event";
      status.className = "tw-status";
    }
    return;
  }

  if (empty) empty.hidden = true;
  setHidden("tw-event-entry-state", false);
  text("tw-entry-event-name", event.name || "Territory War");
  text("tw-entry-event-detail", `${event.territory_name || "South Plains"} · ${String(event.status || "scheduled").toUpperCase()} · ${formatDate(event.starts_at)} to ${formatDate(event.ends_at)}`);

  const isLeader = group.role === "leader";
  if (status) {
    status.textContent = registration ? "Group registered" : "Not registered";
    status.className = `tw-status ${registration ? "live" : ""}`;
  }

  if (registerButton) {
    registerButton.hidden = Boolean(registration) || !isLeader || event.status === "ended";
    registerButton.disabled = false;
  }

  if (!registration) {
    setHidden("tw-lineup-state", true);
    setHidden("tw-attack-state", true);
    setMessage(
      "tw-event-entry-message",
      isLeader
        ? "Register your permanent Group for this event, then choose the six-fighter lineup."
        : "Your Group Leader must register the Group for this event before a lineup can be selected."
    );
    return;
  }

  setMessage("tw-event-entry-message", `Group registered ${formatDate(registration.registered_at)}.`);
  setHidden("tw-lineup-state", false);
  const delay = Number(data.liveSubstitutionDelayMinutes || 10);
  text(
    "tw-lineup-help",
    event.status === "live"
      ? `Only selected lineup members contribute. New substitutions become eligible after ${delay} minutes. Claim Zone presence moves control; verified opposing kills count anywhere inside the Battlefield.`
      : "Only selected lineup members contribute to the war. Claim Zone presence moves control; verified opposing kills count anywhere inside the Battlefield."
  );
  renderLineup(data);
  renderAttack(data);
}

async function loadPublicState() {
  try {
    const data = await api("/api/territory-wars/state");
    renderEvent(data.event);
    renderPresence(data.presence);
    renderLog(data.log);
    renderLeaderboard(data.leaderboard);
    text("tw-registration-count", Number(data.registrationCount || 0));
    text(
      "tw-attack-starts",
      data.attack?.starts_at
        ? formatDate(data.attack.starts_at)
        : "No active attack"
    );

    const protectionUntil = data.event?.protection_until
      ? new Date(data.event.protection_until)
      : null;
    text(
      "tw-protection",
      protectionUntil && protectionUntil.getTime() > Date.now()
        ? `Protected until ${formatDate(data.event.protection_until)}`
        : "None"
    );
    if (currentPlayerState) {
      currentPlayerState.event = data.event;
      currentPlayerState.attack = data.attack;
      renderAttack(currentPlayerState);
    }
  } catch (error) {
    text("tw-event-name", error.message || "Could not load Territory Wars state.");
  }
}

async function loadPlayerState() {
  const me = await loadMe();
  if (!me?.loggedIn) {
    currentPlayerState = null;
    setHidden("tw-login-state", false);
    setHidden("tw-group-create-state", true);
    setHidden("tw-group-current-state", true);
    renderEventEntry({});
    return;
  }

  try {
    const data = await api("/api/territory-wars/me");
    currentPlayerState = data;
    renderGroup(data);
    renderEventEntry(data);
  } catch (error) {
    setMessage("tw-event-entry-message", error.message || "Could not load your Territory Wars Group.", true);
  }
}

async function createGroup(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const name = String(document.getElementById("tw-group-create-name")?.value || "").trim();
  const tag = String(document.getElementById("tw-group-create-tag")?.value || "").trim();
  if (button) button.disabled = true;
  setMessage("tw-group-create-message", "Creating permanent Group…");
  try {
    await api("/api/territory-wars/group", {
      method: "POST",
      body: JSON.stringify({ name, tag }),
    });
    form.reset();
    setMessage("tw-group-create-message", "Group created.");
    await Promise.all([loadPlayerState(), loadPublicState()]);
  } catch (error) {
    setMessage("tw-group-create-message", error.message || "Could not create Group.", true);
  } finally {
    if (button) button.disabled = false;
  }
}

async function acceptGroupInvite(inviteId, button) {
  if (button) button.disabled = true;
  setMessage("tw-group-create-message", "Joining Group…");
  try {
    await api("/api/territory-wars/group/invite/accept", {
      method: "POST",
      body: JSON.stringify({ inviteId }),
    });
    setMessage("tw-group-create-message", "Group invite accepted.");
    await loadPlayerState();
  } catch (error) {
    setMessage("tw-group-create-message", error.message || "Could not accept Group invite.", true);
    if (button) button.disabled = false;
  }
}

async function sendGroupInvite(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const steamId = String(document.getElementById("tw-group-invite-steam")?.value || "").trim();
  if (button) button.disabled = true;
  setMessage("tw-group-invite-message", "Sending Group invite…");
  try {
    const data = await api("/api/territory-wars/group/invite", {
      method: "POST",
      body: JSON.stringify({ steamId }),
    });
    form.reset();
    setMessage("tw-group-invite-message", data.duplicate ? "That player already has a pending invite." : "Group invite sent.");
  } catch (error) {
    setMessage("tw-group-invite-message", error.message || "Could not send Group invite.", true);
  } finally {
    if (button) button.disabled = false;
  }
}

async function registerGroupForEvent() {
  const data = currentPlayerState;
  const button = document.getElementById("tw-event-register-group");
  if (!data?.event?.id) return;
  if (button) button.disabled = true;
  setMessage("tw-event-entry-message", "Registering Group for event…");
  try {
    await api("/api/territory-wars/event-register", {
      method: "POST",
      body: JSON.stringify({ eventId: data.event.id }),
    });
    setMessage("tw-event-entry-message", "Group registered for the Territory War.");
    await Promise.all([loadPlayerState(), loadPublicState()]);
  } catch (error) {
    setMessage("tw-event-entry-message", error.message || "Could not register Group.", true);
    if (button) button.disabled = false;
  }
}

async function saveLineup() {
  const data = currentPlayerState;
  if (!data?.event?.id) return;
  const memberUserIds = Array.from(document.querySelectorAll('.tw-lineup-check:checked')).map((checkbox) => Number(checkbox.value));
  const cap = Number(data.lineupCap || 6);
  if (memberUserIds.length > cap) {
    setMessage("tw-lineup-message", `Choose no more than ${cap} fighters.`, true);
    return;
  }

  const button = document.getElementById("tw-save-lineup");
  if (button) button.disabled = true;
  setMessage("tw-lineup-message", "Saving event lineup…");
  try {
    const result = await api("/api/territory-wars/lineup", {
      method: "POST",
      body: JSON.stringify({ eventId: data.event.id, memberUserIds }),
    });
    const pending = (result.lineup || []).filter((entry) => {
      const activeAt = parseDate(entry.active_from);
      return activeAt && activeAt.getTime() > Date.now();
    }).length;
    setMessage("tw-lineup-message", pending ? `Lineup saved. ${pending} substitution${pending === 1 ? "" : "s"} pending activation.` : "Event lineup saved.");
    await loadPlayerState();
  } catch (error) {
    setMessage("tw-lineup-message", error.message || "Could not save lineup.", true);
  } finally {
    if (button) button.disabled = false;
  }
}

async function declareAttack() {
  const data = currentPlayerState;
  const button = document.getElementById("tw-declare-attack");
  if (!data?.event?.id || !data?.group) return;
  if (!confirm(`Declare an attack on ${data.event.territory_name || "this territory"}? A five-minute warning will start immediately.`)) return;
  if (button) button.disabled = true;
  setMessage("tw-attack-message", "Declaring attack…");
  try {
    const result = await api("/api/territory-wars/attack-declare", {
      method: "POST",
      body: JSON.stringify({ eventId: data.event.id }),
    });
    currentPlayerState.event = result.event;
    currentPlayerState.attack = result.attack;
    renderEvent(result.event);
    renderAttack(currentPlayerState);
    setMessage("tw-attack-message", "Attack declared. Five-minute warning started.");
    await loadPublicState();
  } catch (error) {
    setMessage("tw-attack-message", error.message || "Could not declare attack.", true);
    if (button) button.disabled = false;
  }
}

document.getElementById("tw-group-create-form")?.addEventListener("submit", createGroup);
document.getElementById("tw-group-invite-form")?.addEventListener("submit", sendGroupInvite);
document.getElementById("tw-event-register-group")?.addEventListener("click", registerGroupForEvent);
document.getElementById("tw-save-lineup")?.addEventListener("click", saveLineup);
document.getElementById("tw-declare-attack")?.addEventListener("click", declareAttack);

Promise.all([loadPublicState(), loadPlayerState()]);
setInterval(loadPublicState, 15000);
