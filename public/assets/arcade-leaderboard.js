"use strict";
// Weekly bragging-rights board. Names come from the public route, which never sends Steam IDs.
(() => {
  let lastFetch = 0;
  let pending = null;
  let rendered = false;

  function safeName(name) {
    const value = String(name || "").trim();
    if (!value || /\d{17}/.test(value)) return "Survivor";
    return value;
  }
  function mount() {
    return document.getElementById("arcade-leaderboard");
  }
  function render(section, data) {
    section.hidden = false;
    const heading = document.getElementById("arcade-leaderboard-heading");
    if (heading) heading.textContent = "This week";
    let note = document.getElementById("arcade-leaderboard-note");
    if (!note) {
      note = document.createElement("p");
      note.id = "arcade-leaderboard-note";
      if (heading) heading.after(note);
      else section.prepend(note);
    }
    let reset = "Monday 00:00 Brisbane";
    if (data.resetAt) {
      reset = new Intl.DateTimeFormat("en-AU", {
        timeZone: "Australia/Brisbane", weekday: "long", hour: "2-digit", minute: "2-digit"
      }).format(new Date(data.resetAt)) + " Brisbane";
    }
    note.textContent = "Top 10 correct plays. Resets " + reset + ". Rank is bragging rights only, with no coins or crates.";
    const list = document.getElementById("arcade-leaderboard-list");
    const entries = Array.isArray(data.entries) ? data.entries : [];
    let podium = document.getElementById("arcade-podium");
    if (!podium) {
      podium = document.createElement("div");
      podium.id = "arcade-podium";
      podium.className = "arcade-podium";
      podium.setAttribute("aria-label", "Top three this week");
      if (list) list.before(podium);
      else section.append(podium);
    }
    const yours = data.you || {};
    const podiumCard = row => {
      const card = document.createElement("article");
      card.className = "arcade-podium-card rank-" + row.rank;
      if (Number(row.rank) === Number(yours.rank)) card.classList.add("is-you");
      const rank = document.createElement("span");
      rank.className = "arcade-rank";
      rank.textContent = String(row.rank);
      const name = document.createElement("strong");
      name.textContent = safeName(row.name);
      const score = document.createElement("span");
      score.className = "arcade-score";
      score.textContent = (Number(row.score) || 0) + " correct";
      card.append(rank, name, score);
      return card;
    };
    const byRank = rank => entries.find(row => Number(row.rank) === rank);
    podium.replaceChildren(...[byRank(2), byRank(1), byRank(3)].filter(Boolean).map(podiumCard));
    if (list) {
      list.className = "arcade-board";
      list.replaceChildren();
      if (!entries.length) {
        const empty = document.createElement("li");
        empty.textContent = "No correct plays recorded this week yet.";
        list.append(empty);
      }
      for (const row of entries) {
        if (Number(row.rank) <= 3) continue;
        const item = document.createElement("li");
        if (Number(row.rank) === Number(yours.rank)) item.className = "is-you";
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
    }
    let you = document.getElementById("arcade-leaderboard-you");
    if (!you) {
      you = document.createElement("p");
      you.id = "arcade-leaderboard-you";
      you.className = "arcade-you";
      section.append(you);
    }
    you.textContent = yours.rank == null
      ? "You · " + safeName(yours.name) + " · no correct plays this week"
      : "You · " + safeName(yours.name) + " · rank " + yours.rank + " · " + (Number(yours.score) || 0) + " correct";
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
        if (response.status === 401) {
          section.hidden = true;
          return;
        }
        if (!response.ok) throw new Error(data.error || "Leaderboard unavailable.");
        render(section, data);
        rendered = true;
        lastFetch = Date.now();
      } catch (error) {
        if (rendered) return;
        const content = document.getElementById("arcade-content");
        if (!content || content.hidden) return;
        section.hidden = false;
        const note = document.getElementById("arcade-leaderboard-note") || document.createElement("p");
        note.id = "arcade-leaderboard-note";
        note.textContent = error.message;
        if (!note.parentNode) section.append(note);
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
