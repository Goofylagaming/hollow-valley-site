/* Hollow Valley rules — only published backend policies are authoritative. */
(function () {
  "use strict";
  const { api } = window.HDS;
  const $ = id => document.getElementById(id);
  const CATEGORIES = {
    general:"General", conduct:"Player conduct", combat:"Combat", grouping:"Groups & packs",
    nesting:"Nesting", events:"Events", other:"Other",
  };
  let allRules = [];

  function when(value) {
    const date = new Date(value);
    return value && Number.isFinite(date.getTime())
      ? date.toLocaleString("en-AU", { timeZone:"Australia/Brisbane", dateStyle:"medium", timeStyle:"short" }) + " AEST"
      : "Date unavailable";
  }
  function el(tag, text, cls) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = String(text);
    if (cls) node.className = cls;
    return node;
  }
  function renderRules() {
    const query = $("hv-rules-search").value.trim().toLowerCase();
    const category = $("hv-rules-category").value;
    const matched = allRules.filter(rule =>
      (!category || rule.category === category) &&
      (!query || [rule.title, rule.body, rule.category].some(value =>
        String(value || "").toLowerCase().includes(query)))
    );
    const list = $("hv-rules-list");
    list.replaceChildren();
    $("hv-rules-count").textContent = matched.length + " matching published rule(s)";
    for (const rule of matched) {
      const card = el("article", undefined, "hv-rule-item");
      const meta = el("small", CATEGORIES[rule.category] || "Other");
      const title = el("h3", rule.title);
      const body = el("p", rule.body);
      card.append(meta, title, body);
      list.append(card);
    }
    if (!matched.length) {
      list.append(el("p", allRules.length
        ? "No published rules match these filters."
        : "No official rules have been published to the website yet. Refer to Hollow Valley Discord for the current rules.",
        "hv-guide-empty"));
    }
  }
  async function loadHistory() {
    try {
      const data = await api("/api/community-guides/history");
      const history = Array.isArray(data.history) ? data.history : [];
      const target = $("hv-rules-history");
      target.replaceChildren();
      if (!history.length) {
        target.append(el("p", "No published website rule revisions recorded yet."));
        return;
      }
      for (const item of history) {
        const row = el("article");
        row.append(
          el("strong", "Version " + item.version),
          el("span", when(item.publishedAt)),
          el("small", item.ruleCount + " rules · " + item.packCount + " pack limits · " +
            item.compatibilityCount + " compatibility decisions")
        );
        target.append(row);
      }
    } catch {
      $("hv-rules-history").textContent = "Publication history could not be loaded.";
    }
  }
  async function init() {
    $("hv-rules-search").addEventListener("input", renderRules);
    $("hv-rules-category").addEventListener("change", renderRules);
    try {
      const data = await api("/api/community-guides");
      const published = data.published === true;
      allRules = published && Array.isArray(data.rules) ? data.rules : [];
      $("hv-rules-status").dataset.status = published ? "ready" : "attention";
      $("hv-rules-status").textContent = published
        ? "Published Hollow Valley policies. These entries have been approved by a server administrator."
        : "No approved Hollow Valley rules are published on this website yet. Please consult the current rules on Discord.";
      $("hv-rules-version").textContent = published
        ? "Version " + data.version + " · published " + when(data.publishedAt)
        : "No website policy published";
      renderRules();
    } catch {
      $("hv-rules-status").dataset.status = "attention";
      $("hv-rules-status").textContent = "The rules service is temporarily unavailable. Check Discord for current server rules.";
      $("hv-rules-version").textContent = "Status unavailable";
      $("hv-rules-list").textContent = "Published rules could not be loaded.";
    }
    await loadHistory();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
