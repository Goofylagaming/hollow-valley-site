(function (root, factory) {
  const progress = factory();
  if (typeof module === "object" && module.exports) module.exports = progress;
  else {
    root.HVSubscriberProgress = progress;
    progress.mount(root);
  }
})(typeof window === "undefined" ? globalThis : window, function () {
  "use strict";

  const BASIS = "Subscription payments received this month, after refunds, before Stripe fees";
  const MAX_AGE_MS = 2 * 60 * 60 * 1000;
  const loads = new WeakMap();
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);

  function money(cents) {
    return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
  }

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
      end: Date.UTC(year, month + 1, 1) - 10 * 60 * 60 * 1000,
    };
  }

  function viewOf(data, now = Date.now()) {
    const period = currentMonth(now);
    if (data?.enabled !== true || data.configured !== true || data.currency !== "aud" ||
        data.timeZone !== "Australia/Brisbane" || !monthLabel(data.month) || !period) return null;
    const categories = Array.isArray(data.categories) ? data.categories : [];
    if (!categories.length || categories.length > 50 || categories.some((item) =>
      !item || typeof item.label !== "string" || !item.label.trim() ||
      !Number.isSafeInteger(item.amountCents) || item.amountCents <= 0)) return null;
    const target = categories.reduce((sum, item) => sum + item.amountCents, 0);
    if (!Number.isSafeInteger(target) || target !== data.targetCents) return null;
    const updated = updatedLabel(data.updatedAt);
    const updatedAt = typeof data.updatedAt === "string" ? Date.parse(data.updatedAt) : NaN;
    const periodEnd = typeof data.periodEnd === "string" ? Date.parse(data.periodEnd) : NaN;
    const available = data.available === true && Number.isSafeInteger(data.amountMinor) && !!updated &&
      updatedAt <= now && now - updatedAt <= MAX_AGE_MS && data.month === period.key &&
      periodEnd === period.end && now < periodEnd;
    const raised = available ? data.amountMinor : null;
    return {
      categories, target, available, raised, updated,
      month: monthLabel(period.key),
      percent: available ? raised / target * 100 : null,
      expiresAt: available ? Math.min(updatedAt + MAX_AGE_MS + 1, periodEnd) : null,
      basis: typeof data.basis === "string" && data.basis.trim() ? data.basis : BASIS,
    };
  }

  function render(data, options = {}) {
    const view = viewOf(data, options.now ?? Date.now());
    if (!view) return "";
    const prefix = /^[a-z][a-z0-9-]*$/.test(options.idPrefix || "") ? options.idPrefix : "subscriber-progress";
    const { target, raised, available, categories, month, updated, basis } = view;
    const percent = available ? new Intl.NumberFormat("en-AU", { maximumFractionDigits: 1 }).format(Math.max(0, view.percent)) : "";
    const valueNow = available ? Math.min(100, Math.max(0, view.percent)).toFixed(2) : "0";
    const remaining = available ? Math.max(0, target - raised) : null;
    let cumulative = 0;
    const milestones = categories.map((item, index) => {
      const before = cumulative;
      cumulative += item.amountCents;
      const allocated = available ? Math.min(item.amountCents, Math.max(0, raised - before)) : null;
      const reached = available && allocated === item.amountCents;
      const detail = !available ? "Awaiting verified support total"
        : reached ? "Funding target reached"
          : allocated > 0 ? money(allocated) + " allocated toward this cost"
            : "Next in the monthly budget";
      return `<li class="subscriber-cost${reached ? " is-funded" : ""}">
        <span class="subscriber-cost-marker" aria-hidden="true">${reached ? "✓" : index + 1}</span>
        <div><strong>${escape(item.label)}</strong><small>${escape(detail)}</small></div>
        <span class="subscriber-cost-amount">${escape(money(item.amountCents))}</span>
      </li>`;
    }).join("");
    const amount = available
      ? `<p class="subscriber-amount"><strong>${escape(money(raised))}</strong><span>of ${escape(money(target))} AUD</span></p>`
      : `<p class="subscriber-amount is-awaiting"><strong>Awaiting verification</strong><span>Monthly cost target: ${escape(money(target))} AUD</span></p>`;
    const state = available
      ? `<div class="subscriber-meter" role="progressbar" aria-labelledby="${prefix}-heading" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${valueNow}" aria-valuetext="${escape(money(raised))} AUD received toward ${escape(money(target))} AUD; ${percent}% of the monthly budget"><span style="width:${valueNow}%"></span></div>
        <div class="subscriber-progress-caption"><strong>${percent}% funded</strong><span>${remaining > 0 ? escape(money(remaining)) + " AUD to this month’s target" : raised > target ? escape(money(raised - target)) + " AUD above this month’s target" : "This month’s funding target is reached"}</span></div>${raised < 0 ? '<p class="subscriber-awaiting">Refunds exceeded subscription payments received this month.</p>' : ""}`
      : '<p class="subscriber-awaiting" role="status">The current month’s subscription total has not been verified yet. Progress will appear after a successful refresh.</p>';
    return `<div class="subscriber-header"><div><p class="subscriber-eyebrow">SUBSCRIBER BAR</p><h2 id="${prefix}-heading">Server costs this month</h2><p class="subscriber-period">${escape(month)} · AUD · Australia/Brisbane</p></div>${options.showLink === false ? "" : '<a class="subscriber-link" href="/supporter#tier-grid">Explore memberships <span aria-hidden="true">↗</span></a>'}</div>
      ${amount}${state}
      <details class="subscriber-costs"><summary>Monthly cost milestones <span>${categories.length} ${categories.length === 1 ? "cost" : "costs"}</span></summary><ol>${milestones}</ol><p>Support is allocated to these budget targets in order. Reaching a milestone does not mean a bill has been paid.</p></details>
      <div class="subscriber-footnote"><p>${escape(basis)}.</p><p>${available ? "Verified " + escape(updated) : updated ? "Last successful refresh: " + escape(updated) + ". A current verified total is unavailable." : "A verified update is pending."}</p></div>`;
  }

  function paint(host, data, now) {
    const markup = render(data, { idPrefix: host.id, now });
    if (host.innerHTML !== markup) {
      const costsOpen = host.querySelector?.(".subscriber-costs")?.open;
      const summaryFocused = host.querySelector?.("summary") === host.ownerDocument?.activeElement;
      host.innerHTML = markup;
      const costs = host.querySelector?.(".subscriber-costs");
      if (costs && costsOpen) costs.open = true;
      if (summaryFocused) host.querySelector?.("summary")?.focus();
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
      const data = await api("/api/supporter/progress");
      if (loads.get(host) !== generation) return;
      paint(host, data, now());
      return { ok: true, data };
    } catch {
      if (loads.get(host) !== generation) return;
      // Preserve a known cost goal, but never substitute zero or retain income
      // as current after a failed public read.
      const data = options.previousData ? { ...options.previousData, available: false, amountMinor: null } : null;
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
        // Clear the amount synchronously at expiry, even if the refresh is
        // slow or the page is hidden. Only a fresh response may restore it.
        data = { ...data, available: false, amountMinor: null };
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

  return { money, monthLabel, viewOf, render, load, watch, mount };
});
