"use strict";
// Weekly bragging-rights board. Names come from the public route, which never sends Steam IDs.
(() => {
  let lastFetch = 0;
  let pending = null;

  function safeName(name) {
    const value = String(name || "").trim();
    if (!value || /\d{17}/.test(value)) return "Survivor";
    return value;
  }
  function mount() {
    let section = document.getElementById("arcade-leaderboard");
    const host = document.getElementById("arcade-content");
    if (!section && host) {
      section = document.createElement("section");
      section.id = "arcade-leaderboard";
      section.className = "arcade-panel";
      const progress = host.querySelector("section");
      if (progress) progress.after(section);
      else host.prepend(section);
    }
    return section;
  }
  function render(section, data) {
    section.hidden = false;
    section.replaceChildren();
    const heading = document.createElement("h2");
    heading.id = "arcade-leaderboard-title";
    heading.textContent = "This week";
    section.setAttribute("aria-labelledby", heading.id);
    const note = document.createElement("p");
    let reset = "Monday 00:00 Brisbane";
    if (data.resetAt) {
      reset = new Intl.DateTimeFormat("en-AU", {
        timeZone: "Australia/Brisbane", weekday: "long", hour: "2-digit", minute: "2-digit"
      }).format(new Date(data.resetAt)) + " Brisbane";
    }
    note.textContent = "Top 10 correct plays. Resets " + reset + ". Rank is bragging rights only, with no coins or crates.";
    section.append(heading, note);
    const entries = Array.isArray(data.entries) ? data.entries : [];
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.textContent = "No correct plays recorded this week yet.";
      section.append(empty);
    } else {
      const list = document.createElement("ol");
      list.className = "arcade-board";
      for (const row of entries) {
        const item = document.createElement("li");
        if (data.you && row.rank === data.you.rank) item.className = "is-you";
        const rank = document.createElement("span");
        rank.className = "arcade-rank";
        rank.textContent = String(row.rank);
        const name = document.createElement("span");
        name.textContent = safeName(row.name);
        const score = document.createElement("span");
        score.className = "arcade-score";
        score.textContent = (Number(row.score) || 0) + " correct";
        item.append(rank, name, score);
        list.append(item);
      }
      section.append(list);
    }
    const you = document.createElement("p");
    you.className = "arcade-you";
    const yours = data.you || {};
    you.textContent = yours.rank == null
      ? "You · " + safeName(yours.name) + " · no correct plays this week"
      : "You · " + safeName(yours.name) + " · rank " + yours.rank + " · " + (Number(yours.score) || 0) + " correct";
    section.append(you);
  }
  async function refresh(force) {
    const section = mount();
    if (!section) return;
    if (pending) return pending;
    if (!force && Date.now() - lastFetch < 30000) return;
    pending = (async () => {
      try {
        const response = await fetch("/api/valley-arcade/weekly");
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Leaderboard unavailable.");
        render(section, data);
        lastFetch = Date.now();
      } catch (error) {
        section.hidden = false;
        const message = document.createElement("p");
        message.textContent = error.message;
        const heading = document.createElement("h2");
        heading.textContent = "This week";
        section.replaceChildren(heading, message);
      } finally {
        pending = null;
      }
    })();
    return pending;
  }
  window.HollowValleyArcadeLeaderboard = { refresh };
  refresh(true);
  setInterval(() => refresh(true), 60000);
})();
