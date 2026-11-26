"use strict";
// Recent highlights. Names are already public when they reach the browser.
// A missing route, an empty list, or any error hides the strip.
(() => {
  const host = document.getElementById("arcade-recent");
  if (!host || typeof arcadeRecentLine !== "function") return;
  let pending = null;
  let timer = 0;

  function reduced() {
    return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function hide() {
    host.hidden = true;
    host.classList.remove("is-moving");
    const list = document.getElementById("arcade-recent-list");
    if (list) list.replaceChildren();
  }

  function render(lines) {
    let list = document.getElementById("arcade-recent-list");
    if (!list) {
      list = document.createElement("ul");
      list.id = "arcade-recent-list";
      host.append(list);
    }
    list.classList.remove("is-marquee");
    host.classList.remove("is-moving");
    host.classList.toggle("is-static", reduced());
    list.replaceChildren(...lines.map((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      return item;
    }));
    host.hidden = false;
  }

  async function refresh() {
    if (pending) return pending;
    pending = (async () => {
      try {
        const response = await fetch("/api/valley-arcade/recent-wins");
        if (response.status === 401 || response.status === 404 || !response.ok) {
          hide();
          return;
        }
        const data = await response.json().catch(() => null);
        const entries = data && Array.isArray(data.entries) ? data.entries : [];
        const lines = entries.map((entry) => arcadeRecentLine(entry)).filter(Boolean).slice(0, 10);
        if (!lines.length) hide();
        else render(lines);
      } catch {
        hide();
      } finally {
        pending = null;
      }
    })();
    return pending;
  }

  refresh();
  if (window.matchMedia) {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    motion.addEventListener?.("change", () => host.classList.toggle("is-static", reduced()));
  }
  timer = window.setInterval(refresh, 60000);
  window.addEventListener("pagehide", () => window.clearInterval(timer));
})();
