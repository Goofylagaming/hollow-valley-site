(function (root, factory) {
  const progress = factory();
  if (typeof module === "object" && module.exports) module.exports = progress;
  else {
    root.HVSubscriberProgress = progress;
    progress.mount(root);
  }
})(typeof window === "undefined" ? globalThis : window, function () {
  "use strict";

  const MAX_AGE_MS = 2 * 60 * 60 * 1000;
  const loads = new WeakMap();
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);

  function monthLabel(month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ""))) return "";
    const date = new Date(month + "-15T00:00:00Z");
    if (!Number.isFinite(date.getTime())) return "";
    return new Intl.DateTimeFormat("en-AU", {
      month: "long", year: "numeric", timeZone: "Australia/Brisbane",
    }).format(date);
  }

  function updatedLabel(value) {
    const date = value ? new Date(value) : null;
    if (!date || !Number.isFinite(date.getTime())) return "";
    return new Intl.DateTimeFormat("en-AU", {
      dateStyle: "medium", timeStyle: "short", timeZone: "Australia/Brisbane",
    }).format(date) + " QLD";
  }

  function currentMonth(now) {
    const local = new Date(now + 10 * 60 * 60 * 1000);
    if (!Number.isFinite(local.getTime())) return null;
    const year = local.getUTCFullYear();
    const month = local.getUTCMonth();
    return {
      key: `${year}-${String(month + 1).padStart(2, "0")}`,
      start: Date.UTC(year, month, 1) - 10 * 60 * 60 * 1000,
      end: Date.UTC(year, month + 1, 1) - 10 * 60 * 60 * 1000,
    };
  }

  // Keep only the public projection. A legacy response must never become a
  // source of cost labels, amounts, private provider details or a derived ratio.
  function publicSnapshot(data) {
    if (!data || typeof data !== "object") return null;
    return {
      enabled: data.enabled === true, configured: data.configured === true, available: data.available === true,
      month: typeof data.month === "string" ? data.month : null,
      timeZone: data.timeZone === "Australia/Brisbane" ? data.timeZone : null,
      periodEnd: typeof data.periodEnd === "string" ? data.periodEnd : null,
      updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null,
      coveragePercent: Number.isInteger(data.coveragePercent) && data.coveragePercent >= 0 && data.coveragePercent <= 100
        ? data.coveragePercent : null,
    };
  }

  function viewOf(input, now = Date.now()) {
    const data = publicSnapshot(input);
    const period = currentMonth(now);
    if (!data?.enabled || !data.configured || !data.timeZone || !monthLabel(data.month) || !period) return null;
    const updated = Date.parse(data.updatedAt);
    const end = Date.parse(data.periodEnd);
    const available = data.available && data.coveragePercent !== null && data.month === period.key &&
      end === period.end && updated >= period.start && updated <= now && now - updated <= MAX_AGE_MS;
    return {
      month: monthLabel(period.key), available,
      percent: available ? data.coveragePercent : null,
      updated: available ? updatedLabel(data.updatedAt) : "",
      expiresAt: available ? Math.min(updated + MAX_AGE_MS + 1, end) : null,
    };
  }

  function goalStatus(percent, target) {
    if (percent === null) return "Awaiting update";
    if (percent >= target) return "Reached";
    return target === 50 || percent >= 50 ? "Next goal" : "Ahead";
  }

  function nextStep(percent) {
    if (percent === 100) return "This month’s running costs are fully covered.";
    if (percent >= 75) return "Stretch goal reached. Thank you for supporting the Valley!";
    const target = percent < 50 ? 50 : 75;
    const gap = target - percent;
    return gap + " percentage " + (gap === 1 ? "point" : "points") + " to the " + (target === 50 ? "first" : "stretch") + " goal.";
  }

  function render(data, options = {}) {
    const view = viewOf(data, options.now ?? Date.now());
    if (!view) return "";
    const { month, percent, available, updated } = view;
    const goals = [[50, "First goal"], [75, "Stretch goal"]].map(([target, label]) => {
      const state = goalStatus(percent, target);
      return `<li class="subscriber-goal-step" data-state="${state === "Reached" ? "reached" : state === "Next goal" ? "next" : "pending"}"><span class="subscriber-goal-icon" aria-hidden="true">${state === "Reached" ? "✓" : "◇"}</span><span><strong>${label}: ${target}%</strong><small>${state}</small></span></li>`;
    }).join("");
    const meter = available
      ? `<p class="subscriber-coverage"><strong>${percent}%</strong><span>of this month’s running costs covered</span></p>
        <div class="subscriber-meter" role="progressbar" aria-label="Monthly running costs covered" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}" aria-valuetext="${percent}% of this month’s running costs covered"><span style="width:${percent}%"></span></div>
        <p class="subscriber-next-step">${nextStep(percent)}</p>`
      : '<p class="subscriber-awaiting" role="status"><strong>Awaiting verification</strong>Current coverage will appear here when the latest support has been verified.</p>';
    return `<div class="subscriber-header"><div><p class="subscriber-eyebrow">SUBSCRIBER BAR</p><h2>Earn more Valley Coins</h2><p class="subscriber-intro">Members earn 2× to 5× on eligible Valley Coin rewards, depending on their tier. Every membership helps keep the Valley running.</p></div>${options.showLink === false ? "" : '<a class="subscriber-link" href="/supporter#tier-grid">See membership rewards <span aria-hidden="true">→</span></a>'}</div>
      <div class="subscriber-budget"><p class="subscriber-period">Monthly server support · ${escape(month)} (QLD)</p>${meter}
      <ol class="subscriber-goals" aria-label="Monthly support goals">${goals}</ol>
      ${available ? '<p class="subscriber-verified">Verified ' + escape(updated) + '</p>' : ""}</div>`;
  }

  function paint(host, data, now) {
    const markup = render(data, { now });
    if (host.innerHTML !== markup) {
      const link = host.querySelector?.(".subscriber-link");
      const restoreFocus = link && link === host.ownerDocument?.activeElement;
      host.innerHTML = markup;
      if (restoreFocus) host.querySelector?.(".subscriber-link")?.focus();
    }
    host.hidden = !markup;
  }

  async function load(host, api, options = {}) {
    if (!host || typeof api !== "function") return;
    const now = options.now || Date.now;
    const generation = (loads.get(host) || 0) + 1;
    loads.set(host, generation);
    host.setAttribute("aria-busy", "true");
    try {
      const data = publicSnapshot(await api("/api/supporter/progress"));
      if (loads.get(host) !== generation) return;
      paint(host, data, now());
      return { ok: true, data };
    } catch {
      if (loads.get(host) !== generation) return;
      // Preserve the goals, but never substitute zero or retain a percentage
      // as current after a failed public read.
      const data = options.previousData ? { ...publicSnapshot(options.previousData), available: false, coveragePercent: null } : null;
      paint(host, data, now());
      return { ok: false, data };
    } finally {
      if (loads.get(host) === generation) host.setAttribute("aria-busy", "false");
    }
  }

  function watch(host, { api, document, now = Date.now, timers = globalThis }) {
    let data = null;
    let pending = false;
    let stopped = false;
    let expiryTimer = null;

    function scheduleExpiry() {
      if (expiryTimer !== null) timers.clearTimeout(expiryTimer);
      expiryTimer = null;
      const expiresAt = viewOf(data, now())?.expiresAt;
      if (stopped || !expiresAt) return;
      expiryTimer = timers.setTimeout(() => {
        expiryTimer = null;
        // Clear the percentage synchronously at expiry, even if the refresh is
        // slow or the page is hidden. Only a fresh response may restore it.
        data = { ...data, available: false, coveragePercent: null };
        paint(host, data, now());
        void refresh();
      }, Math.max(1, expiresAt - now()));
    }

    async function refresh() {
      if (stopped) return;
      if (data) paint(host, data, now());
      if (pending) return;
      pending = true;
      try {
        const result = await load(host, api, { now, previousData: data });
        if (stopped) return;
        if (result) data = result.data;
        scheduleExpiry();
      } finally { pending = false; }
    }

    const visible = () => document.visibilityState !== "hidden";
    const onVisibility = () => { if (visible()) void refresh(); };
    document.addEventListener("visibilitychange", onVisibility);
    const interval = timers.setInterval(() => { if (visible()) void refresh(); }, 60000);
    const ready = refresh();
    return {
      ready, refresh,
      dispose() {
        stopped = true;
        loads.set(host, (loads.get(host) || 0) + 1);
        timers.clearInterval(interval);
        if (expiryTimer !== null) timers.clearTimeout(expiryTimer);
        document.removeEventListener("visibilitychange", onVisibility);
      },
    };
  }

  function mount(win) {
    const init = () => {
      for (const host of win.document.querySelectorAll("[data-subscriber-progress]")) {
        watch(host, { api: win.HDS?.api, document: win.document, now: () => win.Date.now(), timers: win });
      }
    };
    if (win.document.readyState === "loading") win.document.addEventListener("DOMContentLoaded", init, { once: true });
    else init();
  }

  return { monthLabel, viewOf, render, load, watch, mount };
});
