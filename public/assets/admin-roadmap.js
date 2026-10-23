(function () {
  "use strict";
  const host = document.getElementById("roadmap-admin-list");
  const status = document.getElementById("roadmap-admin-status");
  const refresh = document.getElementById("roadmap-admin-refresh");
  if (!host || !status) return;
  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  async function request(url, init) {
    const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init });
    const result = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(result.error || "Request failed");
    return result;
  }
  function createEntry(entry) {
    const card = node("article", "roadmap-admin-item");
    card.append(node("h3", "", entry.title));
    card.append(node("p", "", entry.description));
    card.append(node("small", "", "Submitted: " + entry.createdAt + " · Steam ID: " + entry.steamId));
    const actions = node("div", "roadmap-admin-actions");
    if (entry.status === "pending") {
      for (const [decision, caption] of [["approved", "Approve"], ["rejected", "Reject"]]) {
        const button = node("button", "", caption);
        button.type = "button";
        button.addEventListener("click", async function () {
          actions.querySelectorAll("button").forEach(function (el) { el.disabled = true; });
          status.textContent = "Saving moderation decision…";
          try {
            await request("/api/roadmap/admin/suggestions/" + entry.id, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ decision }),
            });
            await load();
          } catch (error) {
            status.textContent = error.message;
            actions.querySelectorAll("button").forEach(function (el) { el.disabled = false; });
          }
        });
        actions.append(button);
      }
    } else {
      actions.append(node("span", "", entry.status + (entry.reviewedAt ? " · " + entry.reviewedAt : "")));
    }
    card.append(actions);
    return card;
  }
  async function load() {
    refresh.disabled = true;
    try {
      const data = await request("/api/roadmap/admin/suggestions");
      const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
      const pending = suggestions.filter(function (item) { return item.status === "pending"; }).length;
      status.textContent = pending + " pending · " + suggestions.length + " total suggestions shown";
      host.replaceChildren();
      if (!suggestions.length) host.append(node("p", "", "No suggestions submitted yet."));
      suggestions.forEach(function (entry) { host.append(createEntry(entry)); });
    } catch (error) {
      status.textContent = "Unable to load suggestions: " + error.message;
    } finally {
      refresh.disabled = false;
    }
  }
  refresh.addEventListener("click", load);
  load();
})();
