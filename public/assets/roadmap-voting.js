/* Community votes are a separate, non-gameplay layer on the 31-feature roadmap. */
(function () {
  "use strict";
  const root = document.getElementById("home-roadmap-stages");
  if (!root) return;
  const status = document.getElementById("roadmap-vote-status");
  const tally = document.getElementById("roadmap-ballot-total");
  const leaders = document.getElementById("roadmap-vote-leaders");
  const form = document.getElementById("roadmap-suggestion-form");
  const formStatus = document.getElementById("roadmap-suggestion-status");
  const formButton = document.getElementById("roadmap-suggestion-send");
  const approvedHost = document.getElementById("roadmap-approved-suggestions");
  const features = new Map();
  const ballot = {
    counts: {},
    mine: new Set(),
    eligible: new Set(),
    max: 3,
    requiresSteam: true,
    busy: true,
  };

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function setMessage(element, message, error) {
    element.textContent = message;
    element.classList.toggle("roadmap-error", Boolean(error));
  }

  // Existing roadmap disclosures, copy and original numbering remain intact.
  root.querySelectorAll(".roadmap-feature").forEach(function (detail) {
    const match = /^roadmap-feature-(\d+)$/.exec(detail.id);
    if (!match) return;
    const id = Number(match[1]);
    const name = detail.querySelector("summary > span:nth-child(2)")?.textContent?.trim() || "Idea " + id;
    const statusLabel = detail.dataset.roadmapStatus;
    const controls = el("div", "roadmap-feature-voting");
    const counter = el("span", "roadmap-vote-count", "Loading votes…");
    controls.append(counter);
    let button = null;
    if (statusLabel === "idea") {
      button = el("button", "roadmap-vote-button", "Vote");
      button.type = "button";
      button.disabled = true;
      button.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-label", "Vote for " + name);
      button.addEventListener("click", function () {
        updateVote(id, !ballot.mine.has(id));
      });
      controls.append(button);
    } else {
      controls.append(el("span", "roadmap-vote-closed", "Not open for voting"));
    }
    detail.append(controls);
    features.set(id, { name, statusLabel, counter, button });
  });

  function render() {
    const used = ballot.mine.size;
    tally.textContent = used + " / " + ballot.max + " votes used";
    features.forEach(function (entry, id) {
      const count = Number(ballot.counts[id] || 0);
      entry.counter.textContent = count + (count === 1 ? " vote" : " votes");
      if (!entry.button) return;
      const chosen = ballot.mine.has(id);
      entry.button.textContent = chosen ? "Remove vote ✓" : "Vote for this";
      entry.button.setAttribute("aria-pressed", String(chosen));
      entry.button.disabled = ballot.busy || ballot.requiresSteam
        || !ballot.eligible.has(id) || (!chosen && used >= ballot.max);
      entry.button.classList.toggle("is-voted", chosen);
      entry.button.title = !ballot.requiresSteam && used >= ballot.max && !chosen
        ? "Remove one of your existing votes to choose this idea." : "";
    });
    leaders.replaceChildren();
    const ranked = [...features.entries()]
      .filter(function ([id]) { return ballot.eligible.has(id); })
      .sort(function (a, b) {
        return Number(ballot.counts[b[0]] || 0) - Number(ballot.counts[a[0]] || 0) || a[0] - b[0];
      }).filter(function ([id]) { return Number(ballot.counts[id] || 0) > 0; }).slice(0, 5);
    if (!ranked.length) {
      leaders.append(el("li", "roadmap-no-votes", "No community votes yet."));
    }
    ranked.forEach(function ([id, entry]) {
      const li = el("li");
      const link = el("a", "", entry.name);
      link.href = "#roadmap-feature-" + id;
      link.addEventListener("click", function () {
        const feature = document.getElementById("roadmap-feature-" + id);
        const stage = feature && feature.closest(".roadmap-stage");
        if (stage) stage.open = true;
        if (feature) feature.open = true;
      });
      li.append(link, el("span", "", String(ballot.counts[id])));
      leaders.append(li);
    });
    if (ballot.requiresSteam) {
      setMessage(status, "Sign in with a linked Steam account to cast up to three votes.", false);
      const link = el("a", "roadmap-signin", "Sign in with Steam ↗");
      link.href = "/auth/steam?returnTo=%2F";
      status.append(" ", link);
    } else {
      setMessage(status, used >= ballot.max
        ? "All three votes are in. You can remove one and vote for another idea."
        : "Choose up to three idea-stage features. Your votes are saved to your Steam account.", false);
    }
    if (formButton) formButton.disabled = ballot.requiresSteam || ballot.busy;
  }

  async function request(url, init) {
    const response = await fetch(url, {
      credentials: "same-origin",
      cache: "no-store",
      ...init,
    });
    const payload = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(payload.error || "The roadmap service is unavailable.");
    return payload;
  }
  function applySummary(data) {
    ballot.counts = data.counts || {};
    ballot.mine = new Set(Array.isArray(data.myVotes) ? data.myVotes : []);
    ballot.eligible = new Set(Array.isArray(data.eligibleFeatureIds) ? data.eligibleFeatureIds : []);
    ballot.max = Number(data.maxVotes) || 3;
    ballot.requiresSteam = data.requiresSteam === true;
    ballot.busy = false;
    render();
  }
  async function loadVotes() {
    try { applySummary(await request("/api/roadmap/votes")); }
    catch (error) {
      ballot.busy = true;
      setMessage(status, "Roadmap votes could not be loaded. " + error.message, true);
      if (formButton) formButton.disabled = true;
    }
  }
  async function updateVote(featureId, selected) {
    if (ballot.busy) return;
    ballot.busy = true;
    render();
    try {
      const data = await request("/api/roadmap/votes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featureId, selected }),
      });
      applySummary(data);
    } catch (error) {
      ballot.busy = false;
      render();
      setMessage(status, error.message, true);
    }
  }
  async function loadApproved() {
    if (!approvedHost) return;
    try {
      const result = await request("/api/roadmap/suggestions");
      approvedHost.replaceChildren();
      if (!result.suggestions || !result.suggestions.length) {
        approvedHost.textContent = "No community suggestions approved yet.";
        return;
      }
      result.suggestions.forEach(function (suggestion) {
        const section = el("article", "roadmap-approved-item");
        section.append(el("strong", "", suggestion.title), el("p", "", suggestion.description));
        approvedHost.append(section);
      });
    } catch {
      approvedHost.textContent = "Suggestions are unavailable right now.";
    }
  }

  if (form) form.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (ballot.busy || ballot.requiresSteam) return;
    formButton.disabled = true;
    setMessage(formStatus, "Sending your idea for review…", false);
    try {
      await request("/api/roadmap/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: document.getElementById("roadmap-suggestion-title").value,
          description: document.getElementById("roadmap-suggestion-description").value,
        }),
      });
      form.reset();
      setMessage(formStatus, "Suggestion received! An admin will review it before it appears publicly.", false);
    } catch (error) {
      setMessage(formStatus, error.message, true);
    } finally {
      formButton.disabled = ballot.busy || ballot.requiresSteam;
    }
  });

  loadVotes();
  loadApproved();
})();
