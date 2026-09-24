const api = window.HDS.api;
const escapeHtml = window.HDS.escapeHtml;

let me = { loggedIn: false, user: null };
let state = { friends: [], incoming: [], outgoing: [], blocked: [] };

function showFriendsAlert(message, type = "info") {
  const el = document.getElementById("friends-alert");
  if (!el) return;
  el.hidden = false;
  el.className = `skin-alert ${type}`;
  el.textContent = message;
  window.clearTimeout(showFriendsAlert.timer);
  showFriendsAlert.timer = window.setTimeout(() => { el.hidden = true; }, 5000);
}

function empty(message, detail) {
  return `<div class="empty-roster"><strong>${escapeHtml(message)}</strong><span>${escapeHtml(detail)}</span></div>`;
}

function avatar(user) {
  const src = String(user?.avatar || "").trim();
  if (src) return `<img class="friend-avatar" src="${escapeHtml(src)}" alt="" loading="lazy">`;
  const initial = String(user?.username || "?").trim().slice(0, 1).toUpperCase();
  return `<span class="friend-avatar friend-avatar-fallback">${escapeHtml(initial)}</span>`;
}

function relativeLastSeen(user) {
  if (user?.online) return "Online now";
  const last = Number(user?.lastSeenAt || 0);
  if (!last) return "Last seen unavailable";
  const diff = Math.max(0, Date.now() - last);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Seen just now";
  if (minutes < 60) return `Last seen ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last seen ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `Last seen ${days}d ago`;
}

function playerCard(user, actions = "", extra = "") {
  return `
    <article class="friend-card" data-steam-id="${escapeHtml(user.steamId)}">
      <div class="friend-identity">
        ${avatar(user)}
        <div>
          <div class="friend-name-row">
            <strong>${escapeHtml(user.username || "Unknown player")}</strong>
            <span class="friend-presence ${user.online ? "online" : ""}"><i></i>${escapeHtml(relativeLastSeen(user))}</span>
          </div>
          <small>Steam ${escapeHtml(user.steamId)}</small>
          ${extra ? `<span class="friend-extra">${escapeHtml(extra)}</span>` : ""}
        </div>
      </div>
      <div class="friend-actions">${actions}</div>
    </article>
  `;
}

function incomingActions(item) {
  return `
    <button class="small-button friend-action" data-action="accept" data-request-id="${item.requestId}">Accept</button>
    <button class="small-button friend-action" data-action="decline" data-request-id="${item.requestId}">Decline</button>
    <button class="small-button friend-action danger" data-action="block" data-steam-id="${escapeHtml(item.user.steamId)}">Block</button>
  `;
}

function outgoingActions(item) {
  return `
    <button class="small-button friend-action" data-action="cancel" data-request-id="${item.requestId}">Cancel request</button>
    <button class="small-button friend-action danger" data-action="block" data-steam-id="${escapeHtml(item.user.steamId)}">Block</button>
  `;
}

function friendActions(user) {
  return `
    <button class="small-button friend-action" data-action="remove" data-steam-id="${escapeHtml(user.steamId)}">Remove</button>
    <button class="small-button friend-action danger" data-action="block" data-steam-id="${escapeHtml(user.steamId)}">Block</button>
  `;
}

function blockedActions(user) {
  return `<button class="small-button friend-action" data-action="unblock" data-steam-id="${escapeHtml(user.steamId)}">Unblock</button>`;
}

function renderState() {
  const friends = state.friends || [];
  const incoming = state.incoming || [];
  const outgoing = state.outgoing || [];
  const blocked = state.blocked || [];
  const online = friends.filter((friend) => friend.online).length;

  document.getElementById("friends-count").textContent = String(friends.length);
  document.getElementById("friends-online-count").textContent = String(online);
  document.getElementById("friends-request-count").textContent = String(incoming.length);
  document.getElementById("friends-incoming-label").textContent = `${incoming.length} pending`;
  document.getElementById("friends-online-label").textContent = `${online} online`;
  document.getElementById("friends-outgoing-label").textContent = `${outgoing.length} pending`;

  document.getElementById("friends-incoming").innerHTML = incoming.length
    ? incoming.map((item) => playerCard(item.user, incomingActions(item), "Wants to be friends")).join("")
    : empty("No incoming requests", "New requests will appear here.");

  document.getElementById("friends-list").innerHTML = friends.length
    ? friends.map((user) => playerCard(user, friendActions(user), user.online ? "Playing on Hollow Valley recently" : "")).join("")
    : empty("No friends yet", "Use the player search above to add someone.");

  document.getElementById("friends-outgoing").innerHTML = outgoing.length
    ? outgoing.map((item) => playerCard(item.user, outgoingActions(item), "Friend request sent")).join("")
    : empty("No sent requests", "Requests you send will appear here.");

  document.getElementById("friends-blocked").innerHTML = blocked.length
    ? blocked.map((item) => playerCard(item.user, blockedActions(item.user), "Blocked")).join("")
    : empty("Nobody blocked", "Players you block will appear here.");
}

async function loadFriends({ silent = false } = {}) {
  if (!me.loggedIn || !me.user?.steam_id) return;
  try {
    state = await api("/api/friends");
    renderState();
  } catch (err) {
    if (!silent) showFriendsAlert(err.message, "error");
  }
}

function searchAction(result) {
  const id = escapeHtml(result.steamId);
  if (result.relationship === "friend") return `<span class="friend-status-pill">Friends</span>`;
  if (result.relationship === "outgoing") {
    return `<button class="small-button friend-action" data-action="cancel" data-request-id="${result.requestId}">Cancel request</button>`;
  }
  if (result.relationship === "incoming") {
    return `
      <button class="small-button friend-action" data-action="accept" data-request-id="${result.requestId}">Accept</button>
      <button class="small-button friend-action" data-action="decline" data-request-id="${result.requestId}">Decline</button>
    `;
  }
  if (result.relationship === "blocked") {
    return `<button class="small-button friend-action" data-action="unblock" data-steam-id="${id}">Unblock</button>`;
  }
  if (result.relationship === "unavailable") return `<span class="friend-status-pill muted">Unavailable</span>`;
  return `<button class="small-button friend-action" data-action="add" data-steam-id="${id}">Add friend</button>`;
}

async function searchPlayers(query) {
  const host = document.getElementById("friends-search-results");
  const q = String(query || "").trim();
  if (q.length < 2) {
    host.innerHTML = empty("Enter at least 2 characters", "Search by username or Steam ID.");
    return;
  }

  host.innerHTML = '<p class="section-intro">Searching players…</p>';
  try {
    const result = await api(`/api/friends/search?q=${encodeURIComponent(q)}`);
    const players = Array.isArray(result.results) ? result.results : [];
    host.innerHTML = players.length
      ? players.map((user) => playerCard(user, searchAction(user))).join("")
      : empty("No players found", "Try another username or the player's Steam ID.");
  } catch (err) {
    host.innerHTML = empty("Search failed", err.message);
  }
}

async function handleAction(button) {
  const action = button.dataset.action;
  const steamId = button.dataset.steamId;
  const requestId = button.dataset.requestId;
  button.disabled = true;

  try {
    if (action === "add") {
      await api("/api/friends/requests", {
        method: "POST",
        body: JSON.stringify({ steamId }),
      });
      showFriendsAlert("Friend request sent.", "success");
    } else if (action === "accept") {
      await api(`/api/friends/requests/${encodeURIComponent(requestId)}/accept`, { method: "POST", body: "{}" });
      showFriendsAlert("Friend request accepted.", "success");
    } else if (action === "decline") {
      await api(`/api/friends/requests/${encodeURIComponent(requestId)}/decline`, { method: "POST", body: "{}" });
      showFriendsAlert("Friend request declined.", "success");
    } else if (action === "cancel") {
      await api(`/api/friends/requests/${encodeURIComponent(requestId)}/cancel`, { method: "POST", body: "{}" });
      showFriendsAlert("Friend request cancelled.", "success");
    } else if (action === "remove") {
      if (!confirm("Remove this player from your friends list?")) return;
      await api(`/api/friends/${encodeURIComponent(steamId)}`, { method: "DELETE" });
      showFriendsAlert("Friend removed.", "success");
    } else if (action === "block") {
      if (!confirm("Block this player? This also removes any friendship or pending request.")) return;
      await api(`/api/friends/${encodeURIComponent(steamId)}/block`, { method: "POST", body: "{}" });
      showFriendsAlert("Player blocked.", "success");
    } else if (action === "unblock") {
      await api(`/api/friends/${encodeURIComponent(steamId)}/block`, { method: "DELETE" });
      showFriendsAlert("Player unblocked.", "success");
    }

    await loadFriends();
    const currentQuery = document.getElementById("friends-search-input").value.trim();
    if (currentQuery.length >= 2) await searchPlayers(currentQuery);
  } catch (err) {
    showFriendsAlert(err.message, "error");
  } finally {
    button.disabled = false;
  }
}

document.addEventListener("click", (event) => {
  const button = event.target.closest(".friend-action");
  if (!button) return;
  handleAction(button);
});

document.getElementById("friends-search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  searchPlayers(document.getElementById("friends-search-input").value);
});

async function init() {
  me = await window.HDS.loadMe();
  if (!me.loggedIn || !me.user?.steam_id) {
    document.querySelector(".friends-shell").innerHTML = `
      <div class="skin-signin-card">
        <strong>Steam sign-in required</strong>
        <span>Sign in with Steam to use Hollow Valley Friends.</span>
        <a class="primary-button green" href="/auth/steam">Sign in with Steam</a>
      </div>
    `;
    return;
  }

  await loadFriends();
  window.setInterval(() => loadFriends({ silent: true }), 30000);
}

init().catch((err) => showFriendsAlert(err.message, "error"));
