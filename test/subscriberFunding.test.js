"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { collectMonthlyFunding, createSubscriberFundingService, monthBounds, FundingError, MAX_AGE_MS } = require("../server/services/subscriberFunding");

const NOW = Date.parse("2026-11-02T00:00:00Z");
const env = {
  STRIPE_LIVE_ENABLED: "true", STRIPE_FINANCE_READ_KEY: "rk_live_fixture",
  STRIPE_PRICE_MEMBER: "price_member", STRIPE_PRICE_ELITE: "price_guardian", STRIPE_PRICE_LEGEND: "price_legend",
};
function fixture({ transactions, charge = {}, invoice = {}, objects = {} } = {}) {
  const at = NOW / 1000 - 30;
  const payment = { id: "ch_member", object: "charge", livemode: true, paid: true, captured: true,
    status: "succeeded", amount: 700, amount_captured: 700, amount_refunded: 0, currency: "aud",
    invoice: "in_member", balance_transaction: "txn_member", ...charge };
  const bill = { id: "in_member", object: "invoice", livemode: true, currency: "aud", subscription: "sub_member",
    lines: { has_more: false, data: [{ id: "il_member", amount: 700, price: { id: "price_member" }, currency: "aud", livemode: true }] }, ...invoice };
  const rows = transactions || [{ id: "txn_member", object: "balance_transaction", amount: 700, currency: "aud",
    type: "charge", created: at, source: "ch_member", fee: 75, net: 625 }];
  const calls = [];
  const prices = Object.fromEntries(["price_member", "price_guardian", "price_legend"].map(id => [
    `/v1/prices/${id}`, { id, object: "price", livemode: true, currency: "aud", active: false,
      recurring: { interval: "month", interval_count: 1 } },
  ]));
  const values = { ...prices, "/v1/charges/ch_member": payment, "/v1/invoices/in_member": bill, ...objects };
  const fetchImpl = async (raw, options) => {
    const url = new URL(raw); calls.push(url);
    assert.equal(url.origin, "https://api.stripe.com");
    assert.equal(options.method, "GET");
    assert.equal(options.headers.Authorization, "Bearer rk_live_fixture");
    if (url.pathname === "/v1/balance_transactions") return { ok: true, json: async () => ({ data: rows, has_more: false }) };
    if (!Object.hasOwn(values, url.pathname)) throw new Error("Unexpected private provider URL");
    return { ok: true, json: async () => values[url.pathname] };
  };
  return { fetchImpl, calls, values, rows };
}
function serviceFixture(t, options = {}) {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  let now = NOW;
  const service = createSubscriberFundingService({ db, env: { ...env }, clock: () => now, ...options });
  return { db, service, advance(ms) { now += ms; } };
}
const costs = [{ id: "hosting", label: "Server hosting", amountCents: 12345 }];
const enable = service => service.setConfig({ enabled: true, categories: costs, version: service.getConfig().version });
const PUBLIC_KEYS = [
  "enabled", "configured", "available", "month", "timeZone", "periodEnd", "updatedAt", "coveragePercent",
].sort();
function summary(now, amountMinor = 700) {
  const { startSeconds, endSeconds, ...period } = monthBounds(now);
  return { ...period, amountMinor, updatedAt: new Date(now).toISOString() };
}

test("fixed Brisbane months are independent of host timezone and handle year and leap boundaries", () => {
  assert.equal(monthBounds(Date.parse("2026-10-31T13:59:59Z")).month, "2026-10");
  assert.equal(monthBounds(Date.parse("2026-10-31T14:00:00Z")).month, "2026-11");
  assert.equal(monthBounds(Date.parse("2026-12-31T14:00:00Z")).periodEnd, "2027-01-31T14:00:00.000Z");
  assert.equal(monthBounds(Date.parse("2024-02-01T00:00:00Z")).periodEnd, "2024-02-29T14:00:00.000Z");
});

test("only configured live nonpreview reporting may read Stripe", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error("Unexpected read"); };
  for (const candidate of [{}, { ...env, STRIPE_LIVE_ENABLED: "false" }, { ...env, STRIPE_PRICE_MEMBER: "" },
    { ...env, STRIPE_PRICE_MEMBER: "price_legend" }, { ...env, SKIN_STUDIO_READ_ONLY: "true" },
    { ...env, RENDER_EXTERNAL_URL: "https://hollow-valley-staging.onrender.com" }]) {
    await assert.rejects(collectMonthlyFunding({ env: candidate, fetchImpl, now: NOW }), FundingError);
  }
  assert.equal(calls, 0);
});

test("gross captured receipts count before fees; forecasts, fees and payouts cannot inflate the bar", async () => {
  const f = fixture();
  f.rows.push(...["payout", "stripe_fee", "topup"].map((type, index) => ({
    id: `txn_other${index}`, object: "balance_transaction", type, amount: 999999, currency: "aud", created: NOW / 1000 - 1,
  })));
  const result = await collectMonthlyFunding({ env, fetchImpl: f.fetchImpl, now: NOW });
  assert.equal(result.amountMinor, 700);
  assert.equal(result.updatedAt, new Date(NOW).toISOString());
  const ledger = f.calls.find(url => url.pathname === "/v1/balance_transactions");
  assert.equal(ledger.searchParams.get("created[gte]"), String(Date.parse("2026-10-31T14:00:00Z") / 1000));
  assert.equal(ledger.searchParams.get("created[lt]"), String(NOW / 1000 + 1));
  assert.equal(ledger.searchParams.get("currency"), "aud");
  const zero = await collectMonthlyFunding({ env, fetchImpl: fixture({ transactions: [] }).fetchImpl, now: NOW });
  assert.equal(zero.amountMinor, 0);
});

test("an empty ledger is not a verified zero until every configured monthly AUD price is verified in the live account", async () => {
  for (const change of [
    { id: "price_wrong" }, { object: "product" }, { currency: "usd" }, { livemode: false },
    { recurring: null }, { recurring: { interval: "year", interval_count: 1 } },
    { recurring: { interval: "month", interval_count: 3 } },
  ]) {
    const f = fixture({ transactions: [] });
    Object.assign(f.values["/v1/prices/price_member"], change);
    await assert.rejects(collectMonthlyFunding({ env, fetchImpl: f.fetchImpl, now: NOW }), FundingError);
    assert.ok(!f.calls.some(url => url.pathname === "/v1/balance_transactions"));
  }
  const f = fixture({ transactions: [] });
  delete f.values["/v1/prices/price_member"];
  await assert.rejects(collectMonthlyFunding({ env, fetchImpl: f.fetchImpl, now: NOW }), FundingError);
});

test("verified coverage floors at each milestone and capped public results reveal no monetary fields", async t => {
  const target = 7200;
  let receipts = 0;
  const { service, advance } = serviceFixture(t, { collect: async ({ now }) => summary(now, receipts) });
  const before = service.getProgress();
  const categories = [{ id: "private-test-item", label: "Private test fixture", amountCents: target }];
  const hidden = service.setConfig({ enabled: false, categories, version: 0 });
  assert.deepEqual(hidden.publicProgress, before, "disabled drafts and empty settings look identical to the public");
  assert.deepEqual(hidden.config.categories, categories);
  assert.equal(hidden.progress.targetCents, target);
  const pending = service.setConfig({ enabled: true, categories, version: hidden.config.version });
  assert.equal(pending.publicProgress.coveragePercent, null);
  assert.deepEqual(Object.keys(pending.publicProgress).sort(), PUBLIC_KEYS);
  for (const [amount, percent] of [
    [-500, 0], [0, 0], [3599, 49], [3600, 50], [5399, 74], [5400, 75],
    [7199, 99], [7200, 100], [9601, 100], [Number.MAX_SAFE_INTEGER, 100],
  ]) {
    receipts = amount;
    const owner = await service.refresh();
    const publicState = service.getProgress();
    assert.deepEqual(Object.keys(publicState).sort(), PUBLIC_KEYS);
    assert.equal(publicState.available, true);
    assert.equal(publicState.coveragePercent, percent);
    assert.deepEqual(owner.publicProgress, publicState);
    assert.equal(owner.progress.amountMinor, amount);
    assert.equal(owner.progress.targetCents, target);
    assert.deepEqual(owner.config.categories, categories);
    assert.doesNotMatch(JSON.stringify(publicState), /private-test-item|Private test fixture|amountMinor|targetCents|currency|basis|fees|income/i);
  }
  advance(MAX_AGE_MS);
  const expired = service.getProgress();
  assert.deepEqual(Object.keys(expired).sort(), PUBLIC_KEYS);
  assert.equal(expired.available, false);
  assert.equal(expired.coveragePercent, null);
  assert.equal(expired.updatedAt, null);
});

test("invoice paid status alone never substitutes for captured funds and matching mode/currency", async () => {
  for (const charge of [
    { paid: false }, { captured: false }, { status: "pending" }, { status: "failed" },
    { amount_captured: 0 }, { amount_captured: 699 }, { currency: "usd" }, { livemode: false },
    { balance_transaction: "txn_other" },
  ]) {
    await assert.rejects(collectMonthlyFunding({ env, fetchImpl: fixture({ charge, invoice: { status: "paid" } }).fetchImpl, now: NOW }), FundingError);
  }
  await assert.rejects(collectMonthlyFunding({ env, fetchImpl: fixture({ invoice: { livemode: false } }).fetchImpl, now: NOW }), FundingError);
});

test("full invoice pagination exposes mixed charges and does not trust the first member line", async () => {
  const f = fixture({ invoice: { lines: { has_more: true, data: [{ id: "il_member", amount: 700, price: { id: "price_member" } }] } },
    objects: { "/v1/invoices/in_member/lines": { has_more: false, data: [
      { id: "il_member", amount: 700, pricing: { price_details: { price: "price_member" } } },
      { id: "il_other", amount: 100, price: { id: "price_merch" } },
    ] } } });
  await assert.rejects(collectMonthlyFunding({ env, fetchImpl: f.fetchImpl, now: NOW }), FundingError);
  assert.ok(f.calls.some(url => url.pathname.endsWith("/lines")));
});

test("pending refunds and unknown adjustments withhold the total; a verified failed-refund reversal restores its cash flow", async () => {
  const at = NOW / 1000 - 5;
  const debit = { id: "txn_refund", object: "balance_transaction", type: "refund", amount: -200, currency: "aud", created: at, source: "re_member" };
  const refund = { id: "re_member", object: "refund", currency: "aud", charge: "ch_member", amount: 200, status: "pending", balance_transaction: "txn_refund" };
  const pending = fixture({ transactions: [debit], objects: { "/v1/refunds/re_member": refund } });
  await assert.rejects(collectMonthlyFunding({ env, fetchImpl: pending.fetchImpl, now: NOW }), FundingError);
  const restored = fixture({ transactions: [debit, { ...debit, id: "txn_restored", type: "refund_failure", amount: 200 }],
    objects: { "/v1/refunds/re_member": { ...refund, status: "failed", failure_balance_transaction: "txn_restored" } } });
  assert.equal((await collectMonthlyFunding({ env, fetchImpl: restored.fetchImpl, now: NOW })).amountMinor, 0);
  const unknown = fixture({ transactions: [{ ...debit, type: "adjustment", source: null }] });
  await assert.rejects(collectMonthlyFunding({ env, fetchImpl: unknown.fetchImpl, now: NOW }), FundingError);
});

test("an unrelated invoice is excluded, but unknown subscription prices or unresolved charge sources cannot be guessed", async () => {
  const unrelated = fixture({ invoice: { subscription: null, lines: { has_more: false, data: [{ id: "il_other", amount: 700, price: { id: "price_other" } }] } } });
  assert.equal((await collectMonthlyFunding({ env, fetchImpl: unrelated.fetchImpl, now: NOW })).amountMinor, 0);
  const ambiguous = fixture({ charge: { invoice: null, payment_intent: null } });
  await assert.rejects(collectMonthlyFunding({ env, fetchImpl: ambiguous.fetchImpl, now: NOW }), FundingError);
});

test("failed refresh immediately invalidates a fresh amount and exposes only a fixed safe error", async t => {
  let fail = false;
  const f = serviceFixture(t, { collect: async ({ now }) => {
    if (fail) throw new Error("secret customer alice@example.com pi_private rk_live_sensitive");
    return summary(now);
  } });
  enable(f.service); await f.service.refresh(); assert.equal(f.service.getProgress().coveragePercent, 5);
  fail = true;
  await assert.rejects(f.service.refresh(), FundingError);
  assert.equal(f.service.getProgress().available, false);
  assert.equal(f.service.getProgress().coveragePercent, null);
  assert.ok(!JSON.stringify(f.service.getOwnerState()).includes("alice"));
  assert.ok(!JSON.stringify(f.db.prepare("SELECT * FROM subscriber_funding_snapshot").all()).includes("private"));
});

test("changing credentials or a price invalidates cached totals without a provider read", async t => {
  const mutable = { ...env };
  const f = serviceFixture(t, { env: mutable, collect: async ({ now }) => summary(now) });
  enable(f.service); await f.service.refresh();
  mutable.STRIPE_PRICE_MEMBER = "price_new";
  assert.equal(f.service.getProgress().coveragePercent, null);
  mutable.STRIPE_PRICE_MEMBER = env.STRIPE_PRICE_MEMBER;
  mutable.STRIPE_FINANCE_READ_KEY = "rk_live_differentAccount";
  assert.equal(f.service.getProgress().coveragePercent, null);
});

test("refreshes have a durable lease and a second worker cannot duplicate an in-progress provider scan", async t => {
  let release;
  let scans = 0;
  const f = serviceFixture(t, { collect: async ({ now }) => { scans++; await new Promise(resolve => { release = resolve; }); return summary(now); } });
  enable(f.service);
  const pending = f.service.refresh();
  await assert.rejects(f.service.refresh(), error => error.code === "busy");
  const second = createSubscriberFundingService({ db: f.db, env, clock: () => NOW, collect: async () => { throw new Error("duplicate scan"); } });
  await assert.rejects(second.refresh(), error => error.code === "busy");
  assert.equal(scans, 1); release(); await pending;
  assert.equal(f.service.getProgress().available, true);
});

test("background polling never reads with the bar disabled and refreshes at most hourly when enabled", async t => {
  let scans = 0;
  const f = serviceFixture(t, { collect: async ({ now }) => { scans++; return summary(now); } });
  let tick;
  const timer = f.service.start({ schedule(fn, ms) { tick = fn; assert.equal(ms, 60000); return { unref() {} }; } });
  assert.ok(timer); await tick(); assert.equal(scans, 0);
  enable(f.service); await tick(); assert.equal(scans, 1);
  f.advance(59 * 60 * 1000); await tick(); assert.equal(scans, 1);
  f.advance(60 * 1000); await tick(); assert.equal(scans, 2);
  f.advance(MAX_AGE_MS + 1); assert.equal(f.service.getProgress().coveragePercent, null);
});

test("settings reject numeric coercion, malformed labels and excessive summed targets atomically", t => {
  const { service } = serviceFixture(t);
  for (const candidate of [
    { ...costs[0], amountCents: "10" }, { ...costs[0], amountCents: 1.5 },
    { ...costs[0], label: "<private>" }, { ...costs[0], label: "bad\nlabel" },
    { ...costs[0], id: "Bad ID" }, { ...costs[0], amountCents: 100000001 },
  ]) assert.throws(() => service.setConfig({ enabled: true, categories: [candidate], version: 0 }), error => error.status === 400);
  assert.throws(() => service.setConfig({ enabled: true, categories: [
    { ...costs[0], amountCents: 60000000 }, { id: "other", label: "Other real costs", amountCents: 60000000 },
  ], version: 0 }), FundingError);
  assert.deepEqual(service.getConfig(), { enabled: false, currency: "aud", categories: [], version: 0 });
});
