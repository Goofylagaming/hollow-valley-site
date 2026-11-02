"use strict";

// Aggregate reporting only. Stripe calls are GETs, and no payment/customer
// identifiers or provider responses are persisted or returned to the browser.
const { createHash } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const { financeConfiguration } = require("./stripeFinance");
const { TIERS, stripePriceId } = require("./supporterTiers");
const { getSkinStudioSafety } = require("../middleware/skinStudioSafety");

const CURRENCY = "aud";
const TIME_ZONE = "Australia/Brisbane";
const BASIS = "Subscription payments received this month, after refunds, before Stripe fees";
const MAX_AGE_MS = 2 * 60 * 60 * 1000;
const REFRESH_MS = 60 * 60 * 1000;
const MAX_TARGET_CENTS = 100000000;
const MESSAGES = Object.freeze({
  configuration: "Live subscription reporting is not configured. Check the Stripe read key and membership prices.",
  preview: "Live subscription reporting is unavailable in a preview environment.",
  disabled: "Add the real monthly costs and enable the Subscriber Bar before refreshing.",
  incomplete: "A complete subscription total could not be verified. Check Stripe read permissions and payment records, then refresh again.",
  busy: "A refresh is already running. Please try again shortly.",
  conflict: "These costs were changed in another session. Reload the saved costs before saving again.",
  invalid: "Enter valid monthly costs with unique IDs, labels of 1–60 characters, and positive whole cent amounts.",
});

class FundingError extends Error {
  constructor(code = "incomplete", status = 502) {
    super(MESSAGES[code] || MESSAGES.incomplete);
    this.code = code;
    this.status = status;
  }
}
function incomplete() { throw new FundingError(); }
function ref(value) { return typeof value === "string" ? value : value?.id || null; }
function whole(value) { return Number.isSafeInteger(value); }

function monthBounds(now = Date.now()) {
  if (!Number.isFinite(now)) incomplete();
  // Brisbane has a fixed UTC+10 offset and does not observe daylight saving.
  const local = new Date(now + 10 * 60 * 60 * 1000);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const start = Date.UTC(year, month, 1) - 10 * 60 * 60 * 1000;
  const end = Date.UTC(year, month + 1, 1) - 10 * 60 * 60 * 1000;
  return {
    month: `${year}-${String(month + 1).padStart(2, "0")}`,
    currency: CURRENCY, timeZone: TIME_ZONE,
    periodStart: new Date(start).toISOString(), periodEnd: new Date(end).toISOString(),
    startSeconds: start / 1000, endSeconds: end / 1000,
  };
}

function reportingConfiguration(env) {
  const config = financeConfiguration(env);
  const prices = Object.keys(TIERS).map(tier => stripePriceId(tier, env));
  if (!config?.live || prices.some(price => !price) || new Set(prices).size !== prices.length) return null;
  return { ...config, prices: new Set(prices) };
}
function scopeHash(env) {
  const config = reportingConfiguration(env);
  return config ? createHash("sha256").update(JSON.stringify([config.secret, [...config.prices].sort()])).digest("hex") : null;
}

// Known movements outside subscription receipts. New/unknown payment types are
// deliberately not silently ignored: they require an accounting review first.
const NON_RECEIPT_TYPES = new Set([
  "payout", "payout_cancel", "payout_failure", "payout_minimum_balance_hold", "payout_minimum_balance_release",
  "stripe_fee", "stripe_fx_fee", "tax_fee", "tax_fund", "fee_credit_funding",
  "topup", "topup_reversal", "transfer", "transfer_cancel", "transfer_failure", "transfer_refund",
  "application_fee", "application_fee_refund", "advance", "advance_funding", "anticipation_repayment",
  "climate_order_purchase", "climate_order_refund", "contribution", "connect_collection_transfer",
  "reserve_transaction", "reserved_funds", "reserve_hold", "reserve_release",
  "payment_network_reserve_hold", "payment_network_reserve_release", "inbound_transfer", "inbound_transfer_reversal",
  "issuing_authorization_hold", "issuing_authorization_release", "issuing_dispute", "issuing_dispute_provisional_credit",
  "issuing_dispute_provisional_credit_reversal", "issuing_transaction", "obligation_outbound", "obligation_reversal_inbound",
  "stripe_balance_payment_debit", "stripe_balance_payment_debit_reversal",
]);

async function collectMonthlyFunding({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now(), maxPages = 20 } = {}) {
  const config = reportingConfiguration(env);
  if (!config) throw new FundingError("configuration", 503);
  if (getSkinStudioSafety(env).readOnly) throw new FundingError("preview", 403);
  if (!whole(maxPages) || maxPages < 1 || maxPages > 20) incomplete();
  const period = monthBounds(now);
  const cutoff = Math.floor(now / 1000);
  const deadline = Date.now() + 120000;
  let requests = 0;
  const cache = new Map();

  async function get(path, params) {
    if (++requests > 1000 || Date.now() >= deadline) incomplete();
    const url = new URL(path, "https://api.stripe.com/v1/");
    if (params) url.search = new URLSearchParams(params).toString();
    try {
      const response = await fetchImpl(url.toString(), {
        method: "GET", headers: { Authorization: `Bearer ${config.secret}` },
        signal: AbortSignal.timeout(Math.max(1, Math.min(12000, deadline - Date.now()))),
      });
      if (!response.ok) incomplete();
      const value = await response.json();
      if (!value || typeof value !== "object" || Array.isArray(value)) incomplete();
      return value;
    } catch { incomplete(); }
  }
  async function object(path, id, kind) {
    const key = `${path}/${encodeURIComponent(id)}`;
    if (!cache.has(key)) cache.set(key, get(key).then(value => {
      if (value.id !== id || value.object !== kind || value.deleted) incomplete();
      return value;
    }));
    return cache.get(key);
  }
  async function list(path, params = {}, cap = maxPages) {
    const items = new Map();
    const cursors = new Set();
    let cursor;
    for (let page = 0; page < cap; page += 1) {
      const value = await get(path, { ...params, limit: "100", ...(cursor ? { starting_after: cursor } : {}) });
      if (!Array.isArray(value.data) || value.data.length > 100 || typeof value.has_more !== "boolean") incomplete();
      for (const item of value.data) {
        if (!item || typeof item.id !== "string" || !item.id) incomplete();
        if (items.has(item.id) && !isDeepStrictEqual(items.get(item.id), item)) incomplete();
        items.set(item.id, item);
      }
      if (!value.has_more) return [...items.values()];
      cursor = value.data.at(-1)?.id;
      if (!cursor || cursors.has(cursor)) incomplete();
      cursors.add(cursor);
    }
    incomplete();
  }

  const invoiceCache = new Map();
  async function memberInvoice(invoiceId) {
    if (!/^in_[A-Za-z0-9_]+$/.test(invoiceId || "")) incomplete();
    if (!invoiceCache.has(invoiceId)) invoiceCache.set(invoiceId, (async () => {
      const invoice = await object("invoices", invoiceId, "invoice");
      if (invoice.livemode !== config.live || !Array.isArray(invoice.lines?.data) || typeof invoice.lines.has_more !== "boolean") incomplete();
      const lines = invoice.lines.has_more
        ? await list(`invoices/${encodeURIComponent(invoiceId)}/lines`)
        : invoice.lines.data;
      if (!lines.length) incomplete();
      const financialLines = [];
      for (const line of lines) {
        if (!whole(line.amount) || (line.livemode !== undefined && line.livemode !== config.live) ||
            (line.invoice && ref(line.invoice) !== invoiceId)) incomplete();
        if (line.amount !== 0) financialLines.push(line);
      }
      const recognized = financialLines.filter(line => config.prices.has(ref(line.price || line.pricing?.price_details?.price)));
      const subscriptionId = ref(invoice.subscription || invoice.parent?.subscription_details?.subscription);
      if (!recognized.length) {
        // A retired/rotated membership price can appear on an old charge
        // refunded now. Do not mistake an unknown subscription for unrelated
        // sales and silently omit its debit from the current month's total.
        if (subscriptionId) incomplete();
        return false;
      }
      if (recognized.length !== financialLines.length || !/^sub_[A-Za-z0-9_]+$/.test(subscriptionId || "") ||
          invoice.currency !== CURRENCY || financialLines.some(line => line.currency && line.currency !== CURRENCY) ||
          (invoice.starting_balance !== undefined && invoice.starting_balance !== 0)) incomplete();
      return true;
    })());
    return invoiceCache.get(invoiceId);
  }

  const chargeCache = new Map();
  async function attributedCharge(chargeId) {
    if (!/^(?:ch|py)_[A-Za-z0-9_]+$/.test(chargeId || "")) incomplete();
    if (!chargeCache.has(chargeId)) chargeCache.set(chargeId, (async () => {
      const charge = await object("charges", chargeId, "charge");
      if (charge.livemode !== config.live || !whole(charge.amount) || !whole(charge.amount_captured) ||
          charge.amount_captured < 0 || charge.amount_captured > charge.amount) incomplete();
      let member;
      const invoiceId = ref(charge.invoice);
      if (invoiceId) {
        member = await memberInvoice(invoiceId);
      } else {
        const intentId = ref(charge.payment_intent);
        if (!/^pi_[A-Za-z0-9_]+$/.test(intentId || "")) incomplete();
        const intent = await object("payment_intents", intentId, "payment_intent");
        if (intent.livemode !== config.live || ref(intent.latest_charge) !== chargeId) incomplete();
        const payments = await list("invoice_payments", {
          "payment[type]": "payment_intent", "payment[payment_intent]": intentId, status: "paid",
        });
        // A complete empty association lookup verifies that this is a
        // non-invoice payment. It is not a recognized membership receipt.
        if (!payments.length) return { charge, member: false };
        let allocated = 0;
        const classifications = new Set();
        for (const payment of payments) {
          if (payment.object !== "invoice_payment" || payment.livemode !== config.live || payment.status !== "paid" ||
              payment.payment?.type !== "payment_intent" || ref(payment.payment.payment_intent) !== intentId ||
              payment.currency !== charge.currency || !whole(payment.amount_paid) || payment.amount_paid <= 0 ||
              !whole(payment.status_transitions?.paid_at) || payment.status_transitions.paid_at > cutoff) incomplete();
          allocated += payment.amount_paid;
          if (!whole(allocated)) incomplete();
          classifications.add(await memberInvoice(ref(payment.invoice)));
        }
        if (classifications.size !== 1 || allocated !== charge.amount_captured ||
            intent.status !== "succeeded" || intent.currency !== charge.currency || intent.amount_received !== charge.amount_captured) incomplete();
        member = classifications.has(true);
      }
      if (member && (charge.currency !== CURRENCY || charge.paid !== true || charge.captured !== true ||
          charge.status !== "succeeded" || charge.amount_captured <= 0)) incomplete();
      return { charge, member };
    })());
    return chargeCache.get(chargeId);
  }

  // An empty account is only a verified zero after the read key proves access
  // to the configured membership prices in that same live Stripe account.
  for (const priceId of config.prices) {
    const price = await object("prices", priceId, "price");
    if (price.livemode !== config.live || price.currency !== CURRENCY ||
        price.recurring?.interval !== "month" || price.recurring.interval_count !== 1) incomplete();
  }
  const transactions = await list("balance_transactions", {
    currency: CURRENCY, "created[gte]": String(period.startSeconds),
    "created[lt]": String(Math.min(period.endSeconds, cutoff + 1)),
  });
  let amountMinor = 0;
  for (const transaction of transactions) {
    if (transaction.object !== "balance_transaction" || !whole(transaction.created) || !whole(transaction.amount)) incomplete();
    if (transaction.created < period.startSeconds || transaction.created >= period.endSeconds || transaction.created > cutoff || transaction.currency !== CURRENCY) continue;
    if (NON_RECEIPT_TYPES.has(transaction.type)) continue;
    const sourceId = ref(transaction.source);
    let attributed;
    if (transaction.type === "charge" || transaction.type === "payment") {
      attributed = await attributedCharge(sourceId);
      if (!attributed.member) continue;
      // Partial-capture balance representations and FX require a separate
      // reconciliation, never an estimated fraction of a charge.
      if (transaction.amount <= 0 || transaction.amount !== attributed.charge.amount_captured ||
          ref(attributed.charge.balance_transaction) !== transaction.id ||
          (transaction.exchange_rate !== null && transaction.exchange_rate !== undefined)) incomplete();
    } else if (["refund", "payment_refund", "refund_failure"].includes(transaction.type) ||
        (transaction.type === "adjustment" && /^(?:re|pyre)_/.test(sourceId || ""))) {
      if (!/^(?:re|pyre)_[A-Za-z0-9_]+$/.test(sourceId || "")) incomplete();
      const refund = await object("refunds", sourceId, "refund");
      attributed = await attributedCharge(ref(refund.charge));
      if (!attributed.member) continue;
      if (refund.currency !== CURRENCY || (refund.livemode !== undefined && refund.livemode !== config.live) ||
          !whole(refund.amount) || refund.amount <= 0 || refund.amount > attributed.charge.amount_captured ||
          Math.abs(transaction.amount) !== refund.amount) incomplete();
      if (transaction.amount < 0) {
        if (ref(refund.balance_transaction) !== transaction.id ||
            !["succeeded", "failed", "canceled"].includes(refund.status) ||
            (refund.status !== "succeeded" && !ref(refund.failure_balance_transaction))) incomplete();
      } else if (transaction.amount > 0) {
        if (!["failed", "canceled"].includes(refund.status) || ref(refund.failure_balance_transaction) !== transaction.id) incomplete();
      } else incomplete();
    } else if (transaction.type === "adjustment" && /^(?:dp|du)_/.test(sourceId || "")) {
      const dispute = await object("disputes", sourceId, "dispute");
      attributed = await attributedCharge(ref(dispute.charge));
      if (!attributed.member) continue;
      if (dispute.livemode !== config.live || dispute.currency !== CURRENCY || !whole(dispute.amount) ||
          !Array.isArray(dispute.balance_transactions) ||
          !dispute.balance_transactions.some(item => item.id === transaction.id && item.amount === transaction.amount && item.currency === CURRENCY) ||
          Math.abs(transaction.amount) !== dispute.amount) incomplete();
    } else if (transaction.type === "adjustment" && ["fee", "fee_refund"].includes(transaction.reporting_category)) {
      continue;
    } else incomplete();
    // Gross signed movements exactly once. Do NOT also subtract the charge's
    // lifetime amount_refunded/disputed flags: their transactions are above.
    amountMinor += transaction.amount;
    if (!whole(amountMinor)) incomplete();
  }
  const { startSeconds, endSeconds, ...publicPeriod } = period;
  return { ...publicPeriod, amountMinor, updatedAt: new Date(now).toISOString() };
}

function validateSettings(input) {
  if (!input || typeof input.enabled !== "boolean" || !whole(input.version) || input.version < 0 ||
      (input.currency !== undefined && input.currency !== CURRENCY) || !Array.isArray(input.categories) ||
      input.categories.length > 8 || (input.enabled && !input.categories.length)) throw new FundingError("invalid", 400);
  const ids = new Set();
  let target = 0;
  const categories = input.categories.map(item => {
    const label = typeof item?.label === "string" ? item.label.trim() : "";
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(item?.id || "") || ids.has(item.id) || !label || label.length > 60 ||
        /[\u0000-\u001f\u007f<>]/.test(label) || !whole(item.amountCents) || item.amountCents <= 0 || item.amountCents > MAX_TARGET_CENTS) {
      throw new FundingError("invalid", 400);
    }
    ids.add(item.id);
    target += item.amountCents;
    if (!whole(target) || target > MAX_TARGET_CENTS) throw new FundingError("invalid", 400);
    return { id: item.id, label, amountCents: item.amountCents };
  });
  return { enabled: input.enabled, currency: CURRENCY, categories, version: input.version };
}

function createSubscriberFundingService({ db, env = process.env, fetchImpl = globalThis.fetch, clock = Date.now, collect = collectMonthlyFunding } = {}) {
  if (!db) throw new TypeError("A database is required");
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscriber_funding_config (
      id INTEGER PRIMARY KEY CHECK (id = 1), enabled INTEGER NOT NULL DEFAULT 0,
      categories_json TEXT NOT NULL DEFAULT '[]', version INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO subscriber_funding_config (id) VALUES (1);
    CREATE TABLE IF NOT EXISTS subscriber_funding_snapshot (
      id INTEGER PRIMARY KEY CHECK (id = 1), month TEXT, currency TEXT, amount_minor INTEGER,
      period_start TEXT, period_end TEXT, updated_at INTEGER, scope_hash TEXT,
      complete INTEGER NOT NULL DEFAULT 0, last_attempt_at INTEGER,
      last_error TEXT, lease_until INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO subscriber_funding_snapshot (id) VALUES (1);
  `);
  function getConfig() {
    const row = db.prepare("SELECT * FROM subscriber_funding_config WHERE id = 1").get();
    try { return validateSettings({ enabled: row.enabled === 1, categories: JSON.parse(row.categories_json), version: row.version }); }
    catch { throw new FundingError("configuration", 503); }
  }
  function setConfig(input) {
    const config = validateSettings(input);
    const changed = db.prepare("UPDATE subscriber_funding_config SET enabled = ?, categories_json = ?, version = version + 1 WHERE id = 1 AND version = ?")
      .run(config.enabled ? 1 : 0, JSON.stringify(config.categories), config.version);
    if (!changed.changes) throw new FundingError("conflict", 409);
    return getOwnerState();
  }
  function getProgress() {
    const now = clock();
    const config = getConfig();
    const { startSeconds, endSeconds, ...period } = monthBounds(now);
    const row = db.prepare("SELECT * FROM subscriber_funding_snapshot WHERE id = 1").get();
    const configured = config.categories.length > 0;
    const available = Boolean(config.enabled && configured && reportingConfiguration(env) && !getSkinStudioSafety(env).readOnly &&
      row.complete === 1 && row.month === period.month && row.currency === CURRENCY && row.scope_hash === scopeHash(env) &&
      row.period_start === period.periodStart && row.period_end === period.periodEnd && whole(row.amount_minor) &&
      whole(row.updated_at) && row.updated_at <= now && now - row.updated_at <= MAX_AGE_MS);
    return {
      enabled: config.enabled, configured, available, ...period,
      targetCents: config.enabled ? config.categories.reduce((total, item) => total + item.amountCents, 0) : null,
      amountMinor: available ? row.amount_minor : null,
      updatedAt: available ? new Date(row.updated_at).toISOString() : null,
      categories: config.enabled ? config.categories : [], basis: BASIS,
    };
  }
  function getOwnerState() {
    const row = db.prepare("SELECT last_error FROM subscriber_funding_snapshot WHERE id = 1").get();
    return { config: getConfig(), progress: getProgress(), lastRefreshError: row.last_error ? (MESSAGES[row.last_error] || MESSAGES.incomplete) : null };
  }
  async function refresh() {
    const config = getConfig();
    if (!config.enabled || !config.categories.length) throw new FundingError("disabled", 409);
    if (getSkinStudioSafety(env).readOnly) throw new FundingError("preview", 403);
    if (!reportingConfiguration(env)) throw new FundingError("configuration", 503);
    const now = clock();
    const scope = scopeHash(env);
    const leaseUntil = now + 180000;
    const lease = db.prepare("UPDATE subscriber_funding_snapshot SET lease_until = ?, last_attempt_at = ? WHERE id = 1 AND lease_until <= ?")
      .run(leaseUntil, now, now);
    if (!lease.changes) throw new FundingError("busy", 409);
    try {
      const result = await collect({ env, fetchImpl, now });
      const expected = monthBounds(now);
      if (scope !== scopeHash(env) || result.month !== expected.month || result.currency !== CURRENCY ||
          result.periodStart !== expected.periodStart || result.periodEnd !== expected.periodEnd ||
          !whole(result.amountMinor) || result.updatedAt !== new Date(now).toISOString()) incomplete();
      const written = db.prepare("UPDATE subscriber_funding_snapshot SET month = ?, currency = ?, amount_minor = ?, period_start = ?, period_end = ?, updated_at = ?, scope_hash = ?, complete = 1, last_error = NULL, lease_until = 0 WHERE id = 1 AND lease_until = ?")
        .run(result.month, CURRENCY, result.amountMinor, result.periodStart, result.periodEnd, now, scope, leaseUntil);
      if (!written.changes) incomplete();
    } catch (error) {
      db.prepare("UPDATE subscriber_funding_snapshot SET complete = 0, last_error = ?, lease_until = 0 WHERE id = 1 AND lease_until = ?")
        .run(error instanceof FundingError && MESSAGES[error.code] ? error.code : "incomplete", leaseUntil);
      throw error instanceof FundingError ? error : new FundingError();
    }
    return getOwnerState();
  }
  function start({ schedule = setInterval } = {}) {
    async function tick() {
      try {
        if (!getConfig().enabled || !reportingConfiguration(env) || getSkinStudioSafety(env).readOnly) return;
        const row = db.prepare("SELECT last_attempt_at, lease_until FROM subscriber_funding_snapshot WHERE id = 1").get();
        if (row.lease_until > clock() || (row.last_attempt_at !== null && clock() - row.last_attempt_at < REFRESH_MS)) return;
        await refresh();
      } catch { /* The owner sees the sanitized refresh state; never log provider data. */ }
    }
    void tick();
    const timer = schedule(tick, 60000);
    timer?.unref?.();
    return timer;
  }
  return { getConfig, setConfig, getProgress, getOwnerState, refresh, start };
}

let defaultService;
function getDefaultService() {
  if (!defaultService) defaultService = createSubscriberFundingService({ db: require("../db").db });
  return defaultService;
}

module.exports = { FundingError, collectMonthlyFunding, createSubscriberFundingService, getDefaultService,
  monthBounds, MAX_AGE_MS, REFRESH_MS, BASIS, validateSettings };
