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

// Synthetic public coverage only. Raw costs and provider records never drive this UI.
function snapshot(overrides = {}) {
  return {
    enabled: true, configured: true, available: true,
    month: "2026-11", timeZone: "Australia/Brisbane", periodEnd: "2026-11-30T14:00:00.000Z",
    updatedAt: "2026-11-02T23:15:00Z", coveragePercent: 42,
    ...overrides,
  };
}

test("public bar is hidden until explicitly enabled with a valid monthly goal", () => {
  for (const input of [null, {}, snapshot({ enabled: false }), snapshot({ configured: false }),
    snapshot({ timeZone: "UTC" }), snapshot({ month: "2026-13" })]) {
    assert.equal(progress.render(input), "");
  }
});

test("only a verified server percentage produces a progress bar; zero is valid", () => {
  const waiting = progress.render(snapshot({ available: false, coveragePercent: null, updatedAt: null }));
  assert.match(waiting, /Awaiting verification/);
  assert.doesNotMatch(waiting, /role="progressbar"|0% covered|data-state="reached"|class="subscriber-verified"/);
  const zero = progress.render(snapshot({ coveragePercent: 0 }));
  assert.match(zero, /aria-valuenow="0" aria-valuetext="0% of this month’s running costs covered"/);
  assert.match(zero, /<strong>0%<\/strong>/);
  assert.match(zero, /50 percentage points to the first goal/);
  assert.doesNotMatch(zero, /data-state="reached"/);
});

test("bar shows a fresh QLD percentage, the membership link and an existing perk", () => {
  const markup = progress.render(snapshot());
  assert.match(markup, /November 2026 \(QLD\)/);
  assert.match(markup, /role="progressbar" aria-label="Monthly running costs covered"/);
  assert.match(markup, /aria-valuenow="42"/);
  assert.match(markup, /Verified 3 Nov 2026, 9:15 am QLD/);
  assert.match(markup, /href="\/supporter#tier-grid">See membership rewards/);
  assert.match(markup, /2× to 5× on eligible Valley Coin rewards/);
  assert.doesNotMatch(markup, /premium skins|extra storage|exclusive skins/i);
  assert.doesNotMatch(progress.render(snapshot(), { showLink: false }), /subscriber-link/);
});

test("first goal, stretch goal and full coverage are correctly distinguished", () => {
  const cases = [
    [49, 0, "1 percentage point to the first goal"],
    [50, 1, "25 percentage points to the stretch goal"],
    [74, 1, "1 percentage point to the stretch goal"],
    [75, 2, "Stretch goal reached"],
    [100, 2, "This month’s running costs are fully covered"],
  ];
  for (const [coveragePercent, reached, status] of cases) {
    const html = progress.render(snapshot({ coveragePercent }));
    assert.match(html, /First goal: 50%/);
    assert.match(html, /Stretch goal: 75%/);
    assert.ok(html.includes(status), `goal copy for ${coveragePercent}%`);
    assert.equal((html.match(/data-state="reached"/g) || []).length, reached);
    assert.match(html, new RegExp('aria-valuenow="' + coveragePercent + '"'));
  }
});

test("malformed percentages, invalid period boundaries and pre-month receipts cannot invent coverage", () => {
  for (const coveragePercent of [null, undefined, "42", -1, 101, 49.9, NaN, Infinity]) {
    assert.doesNotMatch(progress.render(snapshot({ coveragePercent })), /role="progressbar"/);
  }
  assert.match(progress.render(snapshot({ updatedAt: "not-a-date" })), /Awaiting verification/);
  assert.match(progress.render(snapshot({ periodEnd: "2026-11-30T12:00:00Z" })), /Awaiting verification/);
  const brisbaneStart = Date.parse("2026-10-31T14:00:00Z");
  assert.match(progress.render(snapshot({ updatedAt: new Date(brisbaneStart - 2000).toISOString() }),
    { now: brisbaneStart + 1000 }), /Awaiting verification/);
});

test("a legacy financial response cannot reveal costs, vendors, receipts or inferred coverage", async () => {
  const legacy = {
    ...snapshot(), currency: "aud", amountMinor: 12345, targetCents: 98765,
    categories: [{ id: "vendor", label: "SECRET_VENDOR", amountCents: 98765 }],
    basis: '<img src=x onerror="alert(1)"> provider $123.45', email: "PRIVATE_CUSTOMER_EMAIL",
  };
  delete legacy.coveragePercent;
  const host = { id: "test-progress", innerHTML: "", hidden: true, setAttribute() {} };
  const result = await progress.load(host, async () => legacy);
  assert.match(host.innerHTML, /Awaiting verification/);
  assert.doesNotMatch(host.innerHTML, /role="progressbar"/);
  const withPercent = progress.render({ ...legacy, coveragePercent: 63 }, { idPrefix: '" onmouseover="leak' });
  assert.match(withPercent, /aria-valuenow="63"/);
  for (const content of [host.innerHTML, withPercent, JSON.stringify(result.data)]) {
    assert.doesNotMatch(content, /\$|\bAUD\b|SECRET_VENDOR|amountMinor|12345|98765|targetCents|categories|provider|PRIVATE_CUSTOMER_EMAIL|<img|onmouseover=/i);
  }
});

test("failed and disabled reads remove the previous percentage", async () => {
  const host = { id: "test-progress", innerHTML: "", hidden: true, setAttribute() {} };
  const calls = [];
  await progress.load(host, async (url) => { calls.push(url); return snapshot(); });
  assert.equal(host.hidden, false);
  assert.match(host.innerHTML, /aria-valuenow="42"/);
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

test("rendering rejects expired or future-dated coverage and rolls over at Brisbane midnight", () => {
  assert.match(progress.render(snapshot(), { now: TEST_NOW + 2 * 60 * 60 * 1000 }), /role="progressbar"/);
  for (const now of [TEST_NOW - 1, TEST_NOW + 2 * 60 * 60 * 1000 + 1]) {
    const markup = progress.render(snapshot(), { now });
    assert.match(markup, /Awaiting verification/);
    assert.doesNotMatch(markup, /role="progressbar"|42%/);
  }
  const rollover = Date.parse("2026-11-30T14:00:00.000Z");
  const markup = progress.render(snapshot({ updatedAt: new Date(rollover - 1000).toISOString() }), { now: rollover });
  assert.match(markup, /December 2026 \(QLD\)/);
  assert.match(markup, /Awaiting verification/);
  assert.doesNotMatch(markup, /role="progressbar"|42%/);
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
  completePending(snapshot({ coveragePercent: 0 }));
  await settle();
  assert.match(host.innerHTML, /<strong>0%<\/strong>/);
  watcher.dispose();
  assert.equal(clock.active(), 0);
});

test("expiry timers clear coverage while hidden and retain honest awaiting state when refresh fails", async () => {
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
    assert.match(host.innerHTML, /Awaiting verification/, "Coverage is cleared before the network read completes");
    assert.doesNotMatch(host.innerHTML, /role="progressbar"|42%/);
    await settle();
    assert.equal(calls, 2);
    assert.equal(host.hidden, false);
    assert.match(host.innerHTML, new RegExp(month + " 2026"));
    assert.match(host.innerHTML, /First goal: 50%/);
    assert.doesNotMatch(host.innerHTML, /<strong>0%<\/strong>/);
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
    assert.equal((page.match(/src="\/assets\/subscriber-progress\.js\?v=2"/g) || []).length, 1);
  }
  const owner = read("server/pages/adminFinance.html");
  assert.ok(owner.indexOf('id="subscriber-goal"') < owner.indexOf('id="finance-content"'));
  assert.match(owner, /the percentage and 50% \/ 75% milestones/i);
  assert.match(owner, /cost names, individual amounts, the monthly target and the amount received stay private/i);
  assert.match(owner, /id="subscriber-goal-total"/);
  assert.doesNotMatch(owner, /<input[^>]*(raised|amountMinor|targetCents)/);
});
