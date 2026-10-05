const { api, loadMe } = window.HDS;

function text(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? "—";
}

function formatDate(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not set" : date.toLocaleString();
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
    status: "scheduled",
    starts_at: null,
    ends_at: null,
  };

  const owner = Math.max(0, Math.min(100, Number(current.owner_control) || 0));
  const challenger = Math.max(0, Math.min(100, Number(current.challenger_control) || 0));

  text("tw-territory-name", current.territory_name || "South Plains");
  text("tw-event-name", current.name || "Territory War");
  text("tw-owner-name", current.owner_name || "Admin");
  text("tw-challenger-name", current.challenger_name || "Open");
  text("tw-owner-percent", `${owner}%`);
  text("tw-challenger-percent", `${challenger}%`);
  text("tw-starts", formatDate(current.starts_at));
  text("tw-ends", formatDate(current.ends_at));
  setStatus(current.status);

  const ownerBar = document.getElementById("tw-owner-bar");
  const challengerBar = document.getElementById("tw-challenger-bar");
  if (ownerBar) ownerBar.style.width = `${owner}%`;
  if (challengerBar) challengerBar.style.width = `${challenger}%`;
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

function renderMyGroup(data) {
  const card = document.getElementById("tw-my-group-card");
  const group = data?.group;
  if (!card) return;
  if (!group) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  text("tw-group-name", `${group.name}${group.tag ? ` [${group.tag}]` : ""}`);
  text("tw-group-wins", Number(group.wins || 0));
  text("tw-group-captures", Number(group.captures || 0));
  text("tw-group-kills", Number(group.kills || 0));

  const roster = document.getElementById("tw-group-roster");
  if (!roster) return;
  roster.replaceChildren();
  for (const member of data.roster || []) {
    const row = document.createElement("div");
    row.className = "tw-list-row";
    const main = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = member.username || "Player";
    const detail = document.createElement("span");
    detail.textContent = [member.role || "member", member.steam_id ? "Steam linked" : "Steam unlinked", member.discord_id ? "Discord linked" : "Discord unlinked"].join(" · ");
    main.append(strong, detail);
    row.append(main);
    roster.append(row);
  }
}

async function loadPublicState() {
  try {
    const data = await api("/api/territory-wars/state");
    renderEvent(data.event);
    renderLog(data.log);
    renderLeaderboard(data.leaderboard);
  } catch (error) {
    text("tw-event-name", error.message || "Could not load Territory Wars state.");
  }
}

async function loadPlayerState() {
  const me = await loadMe();
  const loginState = document.getElementById("tw-login-state");
  const playerState = document.getElementById("tw-player-state");
  const register = document.getElementById("tw-register");
  const registrationStatus = document.getElementById("tw-registration-status");

  if (!me?.loggedIn) {
    if (loginState) loginState.hidden = false;
    if (playerState) playerState.hidden = true;
    if (registrationStatus) {
      registrationStatus.textContent = "Sign in required";
      registrationStatus.className = "tw-status";
    }
    return;
  }

  if (loginState) loginState.hidden = true;
  if (playerState) playerState.hidden = false;
  try {
    const data = await api("/api/territory-wars/me");
    text("tw-player-summary", `${data.player?.username || "Player"}${data.group ? ` · ${data.group.name}` : " · No Territory group linked yet"}`);
    if (registrationStatus) {
      registrationStatus.textContent = data.registered ? "Registered" : "Not registered";
      registrationStatus.className = `tw-status ${data.registered ? "live" : ""}`;
    }
    if (register) {
      register.textContent = data.registered ? "Registration confirmed" : "Register for Territory Wars";
      register.disabled = Boolean(data.registered);
    }
    renderMyGroup(data);
  } catch (error) {
    text("tw-registration-message", error.message || "Could not load your Territory Wars registration.");
  }
}

async function registerForWar() {
  const button = document.getElementById("tw-register");
  const message = document.getElementById("tw-registration-message");
  if (button) button.disabled = true;
  if (message) {
    message.className = "tw-inline-message";
    message.textContent = "Registering…";
  }
  try {
    await api("/api/territory-wars/register", { method: "POST" });
    if (message) message.textContent = "Registration confirmed.";
    await loadPlayerState();
  } catch (error) {
    if (message) {
      message.className = "tw-inline-message error";
      message.textContent = error.message || "Registration failed.";
    }
    if (button) button.disabled = false;
  }
}

document.getElementById("tw-register")?.addEventListener("click", registerForWar);

Promise.all([loadPublicState(), loadPlayerState()]);
