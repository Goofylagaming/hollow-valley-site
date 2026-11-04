"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");

process.env.DB_PATH = ":memory:";
const { collectMonthlyFunding, createSubscriberFundingService } = require("../server/services/subscriberFunding");

const NOW = Date.parse("2026-11-02T00:00:00.000Z");
const MONTH_START = Date.parse("2026-10-31T14:00:00.000Z");
const MONTH_END = Date.parse("2026-11-30T14:00:00.000Z");
const LIVE_ENV = Object.freeze({
  STRIPE_FINANCE_READ_KEY: "rk_live_review_fixture",
  STRIPE_LIVE_ENABLED: "true",
  STRIPE_PRICE_SUPPORTER: "price_supporter",
  STRIPE_PRICE_GUARDIAN: "price_guardian",
  STRIPE_PRICE_LEGEND: "price_legend",
});

function invoice(id, amount, priceId = "price_supporter") {
  return {
    id, object: "invoice", livemode: true, currency: "aud", status: "paid",
    created: Math.floor((MONTH_START - 40 * 86400000) / 1000),
    subscription: "sub_member", amount_paid: amount, total: amount,
    billing_reason: "subscription_cycle",
    status_transitions: { paid_at: Math.floor(NOW / 1000) },
    lines: { has_more: false, data: [{
      id: "il_" + id, object: "line_item", type: "subscription", subscription: "sub_member",
      amount, currency: "aud", price: { id: priceId },
    }] },
  };
}

function charge(id, invoiceId, amount, extra = {}) {
  return {
    id, object: "charge", livemode: true, currency: "aud", status: "succeeded",
    paid: true, captured: true, amount, amount_captured: amount, amount_refunded: 0,
    refunded: false, disputed: false, invoice: invoiceId,
    balance_transaction: "txn_" + id,
    created: Math.floor((MONTH_START - 3 * 86400000) / 1000),
    ...extra,
  };
}

function transaction(id, source, amount, type = "charge", extra = {}) {
  return {
    id, object: "balance_transaction", source, amount,
    fee: amount > 0 ? 77 : 0, net: amount > 0 ? amount - 77 : amount,
    currency: "aud", created: Math.floor(NOW / 1000),
    type, reporting_category: type, status: "available", ...extra,
  };
}

function stripeFixture({ transactions = [], objects = [], pages = null, invoicePayments = {} } = {}) {
  const prices = [LIVE_ENV.STRIPE_PRICE_SUPPORTER, LIVE_ENV.STRIPE_PRICE_GUARDIAN, LIVE_ENV.STRIPE_PRICE_LEGEND]
    .map(id => ({
      id, object: "price", livemode: true, currency: "aud", active: true, type: "recurring",
      recurring: { interval: "month", interval_count: 1 },
    }));
  const registry = new Map([...prices, ...objects].map(value => [value.id, value]));
  const calls = [];
  let page = 0;
  const fetchImpl = async (raw, options) => {
    const url = new URL(raw);
    calls.push(url);
    assert.equal(url.origin, "https://api.stripe.com");
    assert.equal(options.method || "GET", "GET", "Funding reporting is read-only");
    assert.equal(options.headers.Authorization, "Bearer " + LIVE_ENV.STRIPE_FINANCE_READ_KEY);
    if (url.pathname === "/v1/balance_transactions") {
      const body = pages ? pages[page++] : { data: transactions, has_more: false };
      assert.ok(body, "Unexpected additional balance page");
      return { ok: true, json: async () => body };
    }
    if (url.pathname === "/v1/invoice_payments") {
      const intent = url.searchParams.get("payment[payment_intent]");
      const chargeId = url.searchParams.get("payment[charge]");
      const invoiceId = url.searchParams.get("invoice");
      const data = invoicePayments[intent || chargeId || invoiceId];
      assert.ok(data, "Unexpected invoice-payment attribution query: " + url.search);
      return { ok: true, json: async () => ({ data, has_more: false }) };
    }
    const id = decodeURIComponent(url.pathname.split("/").at(-1));
    const body = registry.get(id);
    assert.ok(body, "Unexpected Stripe fixture read: " + url.pathname);
    return { ok: true, json: async () => body };
  };
  return { fetchImpl, calls, registry };
}

function collect(fixture, options = {}) {
  return collectMonthlyFunding({ env: LIVE_ENV, fetchImpl: fixture.fetchImpl, now: NOW, ...options });
}

function snapshot(now, amountMinor = 1400) {
  const shifted = new Date(now + 10 * 3600000);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  return {
    month: `${year}-${String(month + 1).padStart(2, "0")}`,
    currency: "aud", timeZone: "Australia/Brisbane",
    periodStart: new Date(Date.UTC(year, month, 1) - 10 * 3600000).toISOString(),
    periodEnd: new Date(Date.UTC(year, month + 1, 1) - 10 * 3600000).toISOString(),
    amountMinor, updatedAt: new Date(now).toISOString(),
  };
}

function serviceFixture(t, { now = NOW, env = LIVE_ENV, collectImpl = null } = {}) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  let time = now;
  let reads = 0;
  const service = createSubscriberFundingService({
    db, env, clock: () => time,
    fetchImpl: () => assert.fail("No public/configuration read may call Stripe"),
    collect: async (options) => {
      reads += 1;
      return collectImpl ? collectImpl(options) : snapshot(time);
    },
  });
  return { service, db, now: value => { time = value; }, reads: () => reads };
}

function enable(service) {
  return service.setConfig({
    version: service.getConfig().version, enabled: true,
    categories: [{ id: "game", label: "Game server", amountCents: 15000 }],
  });
}

test("cash receipt date controls the Brisbane month even for old invoices and authorizations", async () => {
  const paid = charge("ch_late", "in_late", 2500);
  const fixture = stripeFixture({
    transactions: [transaction("txn_ch_late", paid.id, 2500)],
    objects: [paid, invoice("in_late", 2500)],
  });
  const value = await collect(fixture);
  assert.equal(value.amountMinor, 2500, "Stripe fees must not be silently subtracted from this gross metric");
  assert.equal(value.month, "2026-11");
  assert.equal(value.periodStart, new Date(MONTH_START).toISOString());
  assert.equal(value.periodEnd, new Date(MONTH_END).toISOString());
  const query = fixture.calls.find(url => url.pathname === "/v1/balance_transactions").searchParams;
  assert.equal(Number(query.get("created[gte]")), MONTH_START / 1000);
  const exclusiveUpper = Math.min(Number(query.get("created[lt]")),
    query.has("created[lte]") ? Number(query.get("created[lte]")) + 1 : Infinity);
  assert.equal(exclusiveUpper, Math.min(MONTH_END / 1000, Math.floor(NOW / 1000) + 1));
  assert.ok(!fixture.calls.some(url => url.pathname === "/v1/invoices" && url.searchParams.has("created[gte]")),
    "Old invoices paid now cannot disappear behind an invoice-creation cutoff");
});

test("partial refunds and refunds for older payments are deducted once in their cash month", async () => {
  const current = charge("ch_current", "in_current", 2500, { amount_refunded: 400 });
  const previous = charge("ch_previous", "in_previous", 1500, { amount_refunded: 700 });
  const refund = (id, target, amount, txId) => ({
    id, object: "refund", charge: target, amount, currency: "aud", status: "succeeded",
    balance_transaction: txId, created: NOW / 1000,
  });
  const fixture = stripeFixture({
    transactions: [
      transaction("txn_ch_current", current.id, 2500),
      transaction("txn_partial", "re_partial", -400, "refund"),
      transaction("txn_old_refund", "re_old", -700, "refund"),
    ],
    objects: [current, previous, invoice("in_current", 2500), invoice("in_previous", 1500),
      refund("re_partial", current.id, 400, "txn_partial"),
      refund("re_old", previous.id, 700, "txn_old_refund")],
  });
  assert.equal((await collect(fixture)).amountMinor, 1400,
    "Use signed refund transactions, without additionally subtracting charge.amount_refunded");
});

test("a refund for a retired subscription price cannot be silently dropped from the monthly total", async () => {
  const previous = charge("ch_retired", "in_retired", 1500, { amount_refunded: 700 });
  const fixture = stripeFixture({
    transactions: [transaction("txn_retired_refund", "re_retired", -700, "refund")],
    objects: [previous, invoice("in_retired", 1500), {
      id: "re_retired", object: "refund", charge: previous.id, amount: 700,
      currency: "aud", status: "succeeded", balance_transaction: "txn_retired_refund",
    }],
  });
  assert.equal((await collect(fixture)).amountMinor, -700);
  fixture.registry.set("in_retired", invoice("in_retired", 1500, "price_retired_supporter"));
  await assert.rejects(collect(fixture), { code: "incomplete" },
    "An unrecognized subscription price needs review, rather than an overstated public total");
});

test("won dispute restoration offsets its debit without excluding the original payment twice", async () => {
  const paid = charge("ch_disputed", "in_disputed", 1500, { disputed: true });
  const debit = transaction("txn_dispute", "dp_won", -1500, "adjustment", { reporting_category: "dispute" });
  const credit = transaction("txn_reinstated", "dp_won", 1500, "adjustment", { reporting_category: "dispute_reversal" });
  const fixture = stripeFixture({
    transactions: [transaction("txn_ch_disputed", paid.id, 1500), debit, credit],
    objects: [paid, invoice("in_disputed", 1500), {
      id: "dp_won", object: "dispute", charge: paid.id, amount: 1500, currency: "aud",
      status: "won", livemode: true, balance_transactions: [debit, credit],
    }],
  });
  assert.equal((await collect(fixture)).amountMinor, 1500);
});

test("modern InvoicePayment attribution can split one captured payment across only member invoices", async () => {
  const paid = charge("ch_modern", null, 1000, { payment_intent: "pi_modern" });
  delete paid.invoice;
  const payment = (id, invoiceId, amount) => ({
    id, object: "invoice_payment", invoice: invoiceId, amount_paid: amount,
    currency: "aud", livemode: true, status: "paid",
    payment: { type: "payment_intent", payment_intent: "pi_modern" },
    status_transitions: { paid_at: Math.floor(NOW / 1000) },
  });
  const fixture = stripeFixture({
    transactions: [transaction("txn_ch_modern", paid.id, 1000)],
    objects: [paid, invoice("in_first", 300), invoice("in_second", 700), {
      id: "pi_modern", object: "payment_intent", livemode: true,
      status: "succeeded", currency: "aud", amount_received: 1000, latest_charge: paid.id,
    }],
    invoicePayments: { pi_modern: [payment("inpay_first", "in_first", 300), payment("inpay_second", "in_second", 700)] },
  });
  assert.equal((await collect(fixture)).amountMinor, 1000);
  fixture.registry.set("in_second", invoice("in_second", 700, "price_unrelated_product"));
  await assert.rejects(collect(fixture), "A mixed member/nonmember allocation cannot count the whole captured amount");
});

test("duplicate balance rows are counted once, and an incomplete page sequence never yields a total", async () => {
  const a = charge("ch_page_a", "in_page_a", 700);
  const b = charge("ch_page_b", "in_page_b", 1500);
  const first = transaction("txn_ch_page_a", a.id, 700);
  const second = transaction("txn_ch_page_b", b.id, 1500);
  const objects = [a, b, invoice("in_page_a", 700), invoice("in_page_b", 1500)];
  const fixture = stripeFixture({ objects, pages: [
    { data: [first], has_more: true }, { data: [first, second], has_more: false },
  ] });
  assert.equal((await collect(fixture)).amountMinor, 2200);
  const incomplete = stripeFixture({ objects, pages: [{ data: [first], has_more: true }] });
  await assert.rejects(collect(incomplete, { maxPages: 1 }), "A reporting limit cannot silently publish a partial total");
});

test("public reads never fetch Stripe and withhold coverage until a configured verified snapshot exists", async (t) => {
  const context = serviceFixture(t);
  assert.equal(context.service.getProgress().available, false);
  assert.equal(context.service.getProgress().coveragePercent, null);
  enable(context.service);
  assert.equal(context.service.getProgress().available, false);
  assert.equal(context.service.getProgress().coveragePercent, null);
  assert.equal(context.reads(), 0);
  await context.service.refresh();
  assert.equal(context.service.getProgress().available, true);
  assert.equal(context.service.getProgress().coveragePercent, 9);
  context.service.getProgress();
  context.service.getOwnerState();
  assert.equal(context.reads(), 1);
});

test("disabling publication hides cost details while retaining them for the owner's editor", async (t) => {
  const context = serviceFixture(t);
  enable(context.service);
  await context.service.refresh();
  const configured = context.service.getConfig();
  context.service.setConfig({ ...configured, enabled: false });
  const progress = context.service.getProgress();
  assert.equal(progress.enabled, false);
  assert.equal(progress.configured, false);
  assert.equal(Object.hasOwn(progress, "targetCents"), false);
  assert.equal(Object.hasOwn(progress, "categories"), false);
  assert.equal(progress.coveragePercent, null);
  assert.doesNotMatch(JSON.stringify(progress), /Game server|15000/);
  assert.deepEqual(context.service.getOwnerState().config.categories, configured.categories);
});

test("a verified snapshot expires after two hours and immediately when the Brisbane month changes", async (t) => {
  const context = serviceFixture(t, { now: MONTH_END - 1000 });
  enable(context.service);
  await context.service.refresh();
  assert.equal(context.service.getProgress().available, true);
  context.now(MONTH_END);
  const nextMonth = context.service.getProgress();
  assert.equal(nextMonth.month, "2026-12");
  assert.equal(nextMonth.available, false);
  assert.equal(nextMonth.coveragePercent, null);
  await context.service.refresh();
  assert.equal(context.service.getProgress().available, true);
  context.now(MONTH_END + 2 * 3600000 + 1);
  assert.equal(context.service.getProgress().available, false);
  assert.equal(context.service.getProgress().coveragePercent, null);
});

test("public projection strips provider/customer details even from a verified collector result", async (t) => {
  const context = serviceFixture(t, { collectImpl: async () => ({
    ...snapshot(NOW), customer: { email: "private-payer@example.invalid" },
    chargeId: "ch_private_details", secret: "rk_live_must_never_escape",
    subscriptions: [{ player: "private-player", customer: "cus_private" }],
  }) });
  enable(context.service);
  await context.service.refresh();
  const publicJson = JSON.stringify(context.service.getProgress());
  assert.doesNotMatch(publicJson, /private-payer|private-player|ch_private|cus_private|rk_live|customer|subscriptions/);
  assert.equal(context.service.getProgress().coveragePercent, 9);
});

test("config validation is atomic and optimistic versions prevent an older owner form overwriting a new target", (t) => {
  const context = serviceFixture(t);
  enable(context.service);
  const original = context.service.getConfig();
  assert.throws(() => context.service.setConfig({
    version: original.version, enabled: true,
    categories: [{ id: "game", label: "Game server", amountCents: 123.5 }],
  }));
  assert.deepEqual(context.service.getConfig(), original);
  assert.throws(() => context.service.setConfig({
    version: original.version - 1, enabled: true,
    categories: [{ id: "game", label: "Game server", amountCents: 99900 }],
  }));
  assert.deepEqual(context.service.getConfig(), original);
});

test("turning publication off while a refresh is running cannot republish income", async (t) => {
  let complete;
  const context = serviceFixture(t, { collectImpl: () => new Promise(resolve => { complete = resolve; }) });
  enable(context.service);
  const refresh = context.service.refresh();
  await Promise.resolve();
  const config = context.service.getConfig();
  context.service.setConfig({ ...config, enabled: false });
  complete(snapshot(NOW));
  try { await refresh; } catch { /* A superseded refresh may be rejected. */ }
  const progress = context.service.getProgress();
  assert.equal(progress.enabled, false);
  assert.equal(progress.available, false);
  assert.equal(progress.coveragePercent, null);
});
