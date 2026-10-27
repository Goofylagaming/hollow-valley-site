/* Home news previews use only approved public updates. */
(function () {
  "use strict";
  const host = document.getElementById("home-updates-list");
  if (!host) return;
  const label = {
    building:"In Development", testing:"Testing", blocked:"Blocked",
    ready:"Ready to Deploy", live:"Live", fixed:"Fix Released",
  };
  function node(tag,text,className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = String(text);
    if (className) element.className = className;
    return element;
  }
  async function init() {
    try {
      const result = await window.HDS.api("/api/site-updates?limit=3");
      const records = Array.isArray(result?.updates) ? result.updates : [];
      host.replaceChildren();
      if (!records.length) {
        host.append(node("p","The first approved development and patch notes will appear here.","hv-home-update-empty"));
        return;
      }
      for (const entry of records) {
        const item = node("a",undefined,"hv-home-update");
        item.href = "/updates#update-" + String(entry.id || "").replace(/[^a-z0-9-]/gi, "");
        const stage = entry.stage==="live" || entry.stage==="fixed"
          ? (entry.verifiedLive ? entry.stage : "unverified") : entry.stage;
        item.append(
          node("small", label[stage] || "Not verified"),
          node("strong", entry.title || "Hollow Valley update"),
          node("span", String(entry.milestone || "") + " · Read more ↗")
        );
        host.append(item);
      }
    } catch {
      host.textContent = "The latest updates could not be loaded.";
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded",init);
  else init();
})();
