"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const progressClient = require("../public/assets/subscriber-progress");
const editor = require("../public/assets/admin-support-goal");
const TEST_NOW = Date.parse("2026-11-02T23:15:00Z");
const progress = {
  ...progressClient,
  render: (data, options = {}) => progressClient.render(data, { now: TEST_NOW, ...options }),
  load: (host, api, options = {}) => progressClient.load(host, api, { now: () => TEST_NOW, ...options }),
};

// Synthetic amounts exercise presentation and validation; no default goal is published.
function snapshot(overrides = {}) {
  return {
    enabled: true, configured: true, available: true,
    month: "2026-11", currency: "aud", timeZone: "Australia/Brisbane",
    periodStart: "2026-10-31T14:00:00.000Z", periodEnd: "2026-11-30T14:00:00.000Z",
    targetCents: 30000, amountMinor: 15000,
    updatedAt: "2026-11-02T23:15:00Z",
    categories: [
      { id: "game", label: "Game hosting", amountCents: 20000 },
      { id: "website", label: "Website and automation", amountCents: 10000 },
    ],
    basis: "Subscription payments received this month, after refunds, before Stripe fees",
    ...overrides,
  };
}

test("public bar is hidden until explicitly enabled with a configured AUD cost goal", () => {
  for (const input of [null, {}, snapshot({ enabled: false }), snapshot({ configured: false }),
    snapshot({ currency: "usd" }), snapshot({ timeZone: "UTC" }), snapshot({ month: "2026-13" }),
    snapshot({ categories: [] }), snapshot({ targetCents: 40000 })]) {
    assert.equal(progress.render(input), "");
  }
});

test("unavailable support is distinct from a verified zero and never fabricates progress", () => {
  const waiting = progress.render(snapshot({ available: false, amountMinor: null, updatedAt: null }));
  assert.match(waiting, /Awaiting verification/);
  assert.match(waiting, /Monthly cost target: \$300\.00 AUD/);
  assert.doesNotMatch(waiting, /role="progressbar"|\$0\.00|0% funded|Funding target reached/);
  const verifiedZero = progress.render(snapshot({ amountMinor: 0 }));
  assert.match(verifiedZero, /<strong>\$0\.00<\/strong>/);
  assert.match(verifiedZero, /role="progressbar"[^>]*aria-valuenow="0\.00"/);
  assert.match(verifiedZero, /0% funded/);
  assert.doesNotMatch(verifiedZero, /Awaiting verification/);
});

test("public bar labels the AUD Brisbane month and allocates support across ordered budget targets", () => {
  const markup = progress.render(snapshot(), { idPrefix: "home-subscriber-progress" });
  assert.match(markup, /November 2026 · AUD · Australia\/Brisbane/);
  assert.match(markup, /\$150\.00<\/strong><span>of \$300\.00 AUD/);
  assert.match(markup, /aria-labelledby="home-subscriber-progress-heading"/);
  assert.match(markup, /aria-valuenow="50\.00"/);
  assert.match(markup, /\$150\.00 allocated toward this cost/);
  assert.match(markup, /Next in the monthly budget/);
  assert.match(markup, /Verified 3 Nov 2026, 9:15 am QLD/);
  assert.match(markup, /does not mean a bill has been paid/);
  assert.doesNotMatch(markup, /Funding target reached/);
});

test("over-target support retains the real total and surplus while the progress bar stays bounded", () => {
  const markup = progress.render(snapshot({ amountMinor: 45000 }));
  assert.match(markup, /<strong>\$450\.00<\/strong>/);
  assert.match(markup, /150% funded/);
  assert.match(markup, /aria-valuenow="100\.00"/);
  assert.match(markup, /style="width:100\.00%"/);
  assert.match(markup, /\$150\.00 AUD above this month’s target/);
  assert.equal((markup.match(/Funding target reached/g) || []).length, 2);
});

test("refunds exceeding current receipts remain a negative AUD total with no negative allocation", () => {
  const markup = progress.render(snapshot({ amountMinor: -2500 }));
  assert.match(markup, /<strong>-\$25\.00<\/strong>/);
  assert.match(markup, /aria-valuenow="0\.00"/);
  assert.match(markup, /0% funded/);
  assert.match(markup, /\$325\.00 AUD to this month’s target/);
  assert.match(markup, /Refunds exceeded subscription payments received this month/);
  assert.doesNotMatch(markup, /Funding target reached|allocated toward this cost|width:-/);
});

test("missing or malformed verified totals are unavailable and do not become zero", () => {
  for (const amountMinor of [null, undefined, "15000", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const markup = progress.render(snapshot({ amountMinor }));
    assert.match(markup, /Awaiting verification/);
    assert.doesNotMatch(markup, /role="progressbar"/);
  }
  assert.match(progress.render(snapshot({ updatedAt: "not-a-date" })), /Awaiting verification/);
});

test("category names, basis and caller IDs cannot inject markup or private fields", () => {
  const input = snapshot();
  input.categories[0].label = '<img src=x onerror="alert(1)">';
  input.basis = '<script>alert("private")</script>';
  input.email = "PRIVATE_CUSTOMER_EMAIL";
  input.paymentId = "PRIVATE_STRIPE_PAYMENT";
  const markup = progress.render(input, { idPrefix: '" onmouseover="alert(2)' });
  assert.match(markup, /&lt;img/);
  assert.match(markup, /&lt;script&gt;/);
  assert.doesNotMatch(markup, /<img|<script|onmouseover=|PRIVATE_CUSTOMER_EMAIL|PRIVATE_STRIPE_PAYMENT/);
});

test("public data read failures and disabled responses cannot leave an old total visible", async () => {
  const host = { id: "test-progress", innerHTML: "", hidden: true, setAttribute() {} };
  const calls = [];
  await progress.load(host, async (url) => { calls.push(url); return snapshot(); });
  assert.equal(host.hidden, false);
  assert.match(host.innerHTML, /\$150\.00/);
  await progress.load(host, async () => { throw new Error("private provider details"); });
  assert.equal(host.hidden, true);
  assert.equal(host.innerHTML, "");
  await progress.load(host, async () => snapshot({ enabled: false }));
  assert.equal(host.hidden, true);
  assert.deepEqual(calls, ["/api/supporter/progress"]);
});

test("a delayed old public response cannot overwrite a newer disabled state", async () => {
  const host = { id: "test-progress", innerHTML: "", hidden: true, setAttribute() {} };
  let finishOld;
  const pending = progress.load(host, () => new Promise((resolve) => { finishOld = resolve; }));
  await progress.load(host, async () => snapshot({ enabled: false }));
  finishOld(snapshot());
  await pending;
  assert.equal(host.hidden, true);
  assert.equal(host.innerHTML, "");
});

test("rendering rejects expired or future-dated income and changes the month at Brisbane midnight", () => {
  assert.match(progress.render(snapshot(), { now: TEST_NOW + 2 * 60 * 60 * 1000 }), /role="progressbar"/);
  for (const now of [TEST_NOW - 1, TEST_NOW + 2 * 60 * 60 * 1000 + 1]) {
    const markup = progress.render(snapshot(), { now });
    assert.match(markup, /Awaiting verification/);
    assert.doesNotMatch(markup, /role="progressbar"|\$150\.00/);
  }
  const rollover = Date.parse("2026-11-30T14:00:00.000Z");
  const markup = progress.render(snapshot({ updatedAt: new Date(rollover - 1000).toISOString() }), { now: rollover });
  assert.match(markup, /December 2026 · AUD/);
  assert.match(markup, /Awaiting verification/);
  assert.doesNotMatch(markup, /role="progressbar"|\$150\.00/);
});

function fakeBrowserClock(start) {
  let at = start;
  let nextId = 0;
  const timeouts = new Map();
  const intervals = new Map();
  const listeners = new Map();
  const document = {
    visibilityState: "visible",
    addEventListener(event, listener) { listeners.set(event, listener); },
    removeEventListener(event, listener) { if (listeners.get(event) === listener) listeners.delete(event); },
  };
  return {
    now: () => at, document,
    timers: {
      setTimeout(callback, delay) { const id = ++nextId; timeouts.set(id, { callback, at: at + delay }); return id; },
      clearTimeout(id) { timeouts.delete(id); },
      setInterval(callback, delay) { assert.equal(delay, 60000); const id = ++nextId; intervals.set(id, callback); return id; },
      clearInterval(id) { intervals.delete(id); },
    },
    setVisibility(state) { document.visibilityState = state; listeners.get("visibilitychange")?.(); },
    tickInterval() { for (const callback of intervals.values()) callback(); },
    advanceTo(value) {
      at = value;
      for (const [id, entry] of [...timeouts]) if (entry.at <= at) { timeouts.delete(id); entry.callback(); }
    },
    active: () => intervals.size + timeouts.size + listeners.size,
  };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("public polling reads once per visible minute, resumes on visibility and avoids overlapping requests", async () => {
  const clock = fakeBrowserClock(TEST_NOW);
  const host = { id: "test-progress", innerHTML: "", hidden: true, setAttribute() {} };
  let calls = 0;
  let completePending;
  const watcher = progress.watch(host, {
    ...clock,
    api: async (url) => {
      assert.equal(url, "/api/supporter/progress");
      calls++;
      if (calls === 3) return new Promise((resolve) => { completePending = resolve; });
      return snapshot();
    },
  });
  await watcher.ready;
  assert.equal(calls, 1);
  clock.tickInterval();
  await settle();
  assert.equal(calls, 2);
  clock.setVisibility("hidden");
  clock.tickInterval();
  await settle();
  assert.equal(calls, 2);
  clock.setVisibility("visible");
  assert.equal(calls, 3);
  clock.tickInterval();
  assert.equal(calls, 3, "Do not stack reads while a previous one is pending");
  completePending(snapshot({ amountMinor: 0 }));
  await settle();
  assert.match(host.innerHTML, /<strong>\$0\.00<\/strong>/);
  watcher.dispose();
  assert.equal(clock.active(), 0);
});

test("expiry timers clear income while hidden and retain honest awaiting state when refresh fails", async () => {
  const rollover = Date.parse("2026-11-30T14:00:00.000Z");
  for (const [start, deadline, month] of [
    [TEST_NOW, TEST_NOW + 2 * 60 * 60 * 1000 + 1, "November"],
    [rollover - 1000, rollover, "December"],
  ]) {
    const clock = fakeBrowserClock(start);
    const host = { id: "test-progress", innerHTML: "", hidden: true, setAttribute() {} };
    let calls = 0;
    const watcher = progress.watch(host, {
      ...clock,
      api: async () => {
        if (++calls > 1) throw new Error("Fixture offline");
        return snapshot({ updatedAt: new Date(start).toISOString() });
      },
    });
    await watcher.ready;
    assert.match(host.innerHTML, /role="progressbar"/);
    clock.setVisibility("hidden");
    clock.advanceTo(deadline);
    assert.match(host.innerHTML, /Awaiting verification/, "Amount is cleared before the network read completes");
    assert.doesNotMatch(host.innerHTML, /role="progressbar"|\$150\.00/);
    await settle();
    assert.equal(calls, 2);
    assert.equal(host.hidden, false);
    assert.match(host.innerHTML, new RegExp(month + " 2026 · AUD"));
    assert.match(host.innerHTML, /Monthly cost target: \$300\.00 AUD/);
    assert.doesNotMatch(host.innerHTML, /\$0\.00/);
    watcher.dispose();
  }
});

test("owner costs convert decimal AUD exactly and reject partial or non-money values", () => {
  for (const [input, expected] of [["12.34", 1234], ["0.01", 1], ["9.9", 990], ["250", 25000]]) {
    assert.equal(editor.amountToCents(input), expected);
  }
  for (const input of ["", "0", "-10", "1.234", "1e3", "1,000", "NaN", "1000000.01"]) {
    assert.throws(() => editor.amountToCents(input));
  }
});

test("owner saves ordered costs and revision, with no independently editable target or income", () => {
  const draft = editor.draftOf({
    enabled: true, version: 4,
    rows: [{ id: "game", label: " Game hosting ", amount: "200" },
      { id: "web", label: "Website", amount: "100" }, { id: "empty", label: "", amount: "" }],
  });
  assert.deepEqual(draft, {
    enabled: true, version: 4,
    categories: [{ id: "game", label: "Game hosting", amountCents: 20000 }, { id: "web", label: "Website", amountCents: 10000 }],
  });
  assert.deepEqual(editor.draftOf({ enabled: false, version: 0, rows: [] }), { enabled: false, version: 0, categories: [] });
  assert.throws(() => editor.draftOf({ enabled: true, version: 0, rows: [] }));
  assert.throws(() => editor.draftOf({ enabled: true, version: null, rows: [] }));
});

test("owner validation rejects ambiguous costs, duplicate IDs, unsafe labels and target overflow", () => {
  for (const rows of [
    [{ id: "game", label: "Game", amount: "" }],
    [{ id: "game", label: "", amount: "10" }],
    [{ id: "game", label: "<script>", amount: "10" }],
    [{ id: "game", label: "x".repeat(61), amount: "10" }],
    [{ id: "game", label: "Game", amount: "10" }, { id: "game", label: "Other", amount: "20" }],
    [{ id: "game", label: "Game", amount: "1000000" }, { id: "web", label: "Web", amount: "0.01" }],
    Array.from({ length: 9 }, (_, i) => ({ id: "cost-" + i, label: "Cost", amount: "1" })),
  ]) assert.throws(() => editor.draftOf({ enabled: true, version: 0, rows }));
  assert.doesNotMatch(editor.rowMarkup({ id: '" onclick="alert(1)', label: '<svg onload="alert(1)">' }), /<svg|id="" onclick=/);
});

test("public pages start hidden and the owner editor is separate from private Stripe reporting", () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  for (const file of ["public/index.html", "public/supporter.html"]) {
    const page = read(file);
    assert.match(page, /data-subscriber-progress hidden/);
    assert.equal((page.match(/src="\/assets\/subscriber-progress\.js\?v=1"/g) || []).length, 1);
  }
  const owner = read("server/pages/adminFinance.html");
  assert.ok(owner.indexOf('id="subscriber-goal"') < owner.indexOf('id="finance-content"'));
  assert.match(owner, /cost names, amounts and the aggregate subscription total/);
  assert.match(owner, /id="subscriber-goal-total"/);
  assert.doesNotMatch(owner, /<input[^>]*(raised|amountMinor|targetCents)/);
});
