/* Read-only Hollow Valley news feed. Never treats development notes as live. */
(function () {
  "use strict";
  const { api } = window.HDS;
  const $ = (id) => document.getElementById(id);
  const STAGES = {
    building: "In Development", testing: "Testing", blocked: "Blocked",
    ready: "Ready to Deploy", live: "Live", fixed: "Fix Released",
  };
  const CATEGORIES = {
    website: "Website", game: "Game Server",
    automation: "Automation", community: "Community",
  };
  const LIMIT = 20;
  let page = 0, busy = false, more = false;

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  }
  function formatDate(value) {
    const date = new Date(value);
    if (!value || !Number.isFinite(date.getTime())) return "Date unavailable";
    return date.toLocaleString("en-AU", {
      timeZone: "Australia/Brisbane", dateStyle: "medium", timeStyle: "short",
    }) + " AEST";
  }
  function referenceUrl(value) {
    return typeof value === "string" &&
      /^https:\/\/github\.com\/Goofylagaming\/hollow-valley-site\/(?:pull\/[1-9]\d*|commit\/[0-9a-f]{40}|actions\/runs\/[1-9]\d*)\/?$/.test(value)
      ? value : null;
  }
  function show(update) {
    const verifiedLive = update.verifiedLive === true &&
      ["live", "fixed"].includes(update.stage);
    const stage = ["live", "fixed"].includes(update.stage) && !verifiedLive
      ? "unverified" : (STAGES[update.stage] ? update.stage : "unverified");
    const label = stage === "unverified" ? "Verification unavailable" : STAGES[stage];
    const card = node("article", undefined, "hv-update-card");
    card.id = "update-" + String(update.id || "").replace(/[^a-z0-9-]/gi, "");
    const head = node("div", undefined, "hv-update-card-head");
    const badge = node("span", label, "hv-update-stage");
    badge.dataset.stage = stage;
    const meta = node("small", (CATEGORIES[update.category] || "Community") + " · " +
      String(update.milestone || "Milestone") + " · " + formatDate(update.publishedAt), "hv-update-card-meta");
    head.append(badge, meta);
    card.append(head, node("h3", update.title || "Hollow Valley update"),
      node("p", update.summary || ""));
    const footer = node("div", undefined, "hv-update-card-footer");
    const source = referenceUrl(update.referenceUrl);
    if (source) {
      const link = node("a", "View GitHub source ↗");
      link.href = source;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      footer.append(link);
    } else footer.append(node("small", "No linked GitHub reference"));
    footer.append(node("small", verifiedLive
      ? "Deployment revision verified"
      : "Development notice · not a verified live release"));
    card.append(footer);
    return card;
  }
  function filters() {
    return {
      q: $("hv-updates-search").value.trim().slice(0,120),
      stage: $("hv-updates-stage").value,
      category: $("hv-updates-category").value,
      limit: String(LIMIT),
    };
  }
  async function load(append) {
    if (busy) return;
    busy = true;
    const formButton = $("hv-updates-filters").querySelector("button[type=submit]");
    const moreButton = $("hv-updates-more");
    formButton.disabled = true;
    moreButton.disabled = true;
    $("hv-updates-feedback").textContent = append ? "Loading more updates…" : "Loading published milestones…";
    const nextPage = append ? page + 1 : 0;
    try {
      const params = new URLSearchParams({...filters(),page:String(nextPage)});
      const data = await api("/api/site-updates?" + params.toString());
      const records = Array.isArray(data.updates) ? data.updates : [];
      if (!append) $("hv-updates-list").replaceChildren();
      for (const record of records) $("hv-updates-list").append(show(record));
      if (!records.length && !append) {
        $("hv-updates-list").append(node("p",
          "No published updates yet. Hollow Valley will show staff-approved development notes and verified release announcements here once publishing is activated.",
          "hv-update-empty"));
      }
      page = nextPage;
      more = data.hasMore === true;
      moreButton.hidden = !more;
      $("hv-updates-feedback").textContent =
        $("hv-updates-list").querySelectorAll(".hv-update-card").length +
        " published update(s) shown" + (more ? " · more available" : "");
    } catch(error) {
      $("hv-updates-feedback").textContent = "Updates could not be loaded right now.";
      if (!append) $("hv-updates-list").replaceChildren(
        node("p", "The changelog is temporarily unavailable. See Hollow Valley Discord for community information.", "hv-update-empty")
      );
    } finally {
      busy = false;
      formButton.disabled = false;
      moreButton.disabled = false;
    }
  }
  function init() {
    $("hv-updates-filters").addEventListener("submit", e => {e.preventDefault();load(false);});
    $("hv-updates-category").addEventListener("change",()=>load(false));
    $("hv-updates-stage").addEventListener("change",()=>load(false));
    $("hv-updates-more").addEventListener("click",()=>{if (more)load(true);});
    load(false);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded",init);
  else init();
})();
