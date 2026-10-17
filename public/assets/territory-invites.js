"use strict";

const statusLine = document.getElementById("status");
const inviteList = document.getElementById("invites");

function status(message, error = false) {
  statusLine.textContent = message;
  statusLine.className = error ? "error" : "muted";
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function loadInvites() {
  inviteList.replaceChildren();
  status("Loading your group invitations…");
  try {
    const data = await api("/api/territory-wars/invites");
    if (data.group) {
      status(`You're already in ${data.group.name}${data.group.tag ? " [" + data.group.tag + "]" : ""}. No invitations to accept.`);
      return;
    }
    const invites = Array.isArray(data.invites) ? data.invites : [];
    if (!invites.length) {
      status("No pending Territory Wars group invitations for your Steam account yet.");
      return;
    }
    status(`${invites.length} pending group invitation${invites.length === 1 ? "" : "s"}.`);
    for (const invite of invites) {
      const row = document.createElement("div");
      row.className = "invite";
      const information = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = `${invite.group_name || "Territory Group"}${invite.group_tag ? " [" + invite.group_tag + "]" : ""}`;
      const detail = document.createElement("span");
      detail.textContent = `Invited by ${invite.invited_by || "Group leader"}`;
      information.append(name, detail);

      const accept = document.createElement("button");
      accept.type = "button";
      accept.textContent = "Accept invite";
      accept.addEventListener("click", async () => {
        accept.disabled = true;
        status("Accepting group invitation…");
        try {
          await api("/api/territory-wars/group/invite/accept", {
            method: "POST",
            body: JSON.stringify({ inviteId: invite.id }),
          });
          await loadInvites();
        } catch (error) {
          status(error.message, true);
          accept.disabled = false;
        }
      });
      row.append(information, accept);
      inviteList.append(row);
    }
  } catch (error) {
    status(error.message || "Unable to load group invites.", true);
  }
}
loadInvites();
