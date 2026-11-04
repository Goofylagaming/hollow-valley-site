// Owner-only, read-only Stripe reporting. No Stripe writes, no bank identifiers,
// no secrets, and no persistent copies of customer financial data.
const { liveModeEnabled } = require("./supporterCheckout");
const { tierFromSubscription, subscriptionPeriodEnd } = require("./supporterWebhook");
const { TIERS } = require("./supporterTiers");

const STRIPE_API = "https://api.stripe.com/v1/";
const MAX_SUBSCRIPTION_PAGES = 20; // 2,000; fail rather than report a false total
const MAX_PAYOUT_PAGES = 5; // recent 500 payouts; flag any older records

function financeConfiguration(env = process.env) {
  const secret = String(env.STRIPE_FINANCE_READ_KEY || env.STRIPE_SECRET_KEY || "").trim();
  const live = liveModeEnabled(env);
  const pattern = live ? /^(sk|rk)_live_\w+$/ : /^(sk|rk)_test_\w+$/;
  return pattern.test(secret) ? { secret, live } : null;
}

function iso(seconds) {
  const number = Number(seconds);
  return Number.isFinite(number) && number > 0
    ? new Date(number * 1000).toISOString()
    : null;
}

function safeCurrency(value) {
  const currency = String(value || "").toLowerCase();
  return /^[a-z]{3}$/.test(currency) ? currency : null;
}

async function stripeGet(path, params, { secret, fetchImpl }) {
  const url = new URL(path, STRIPE_API);
  if (params) url.search = params.toString();
  const response = await fetchImpl(url.toString(), {
    method: "GET",
    headers: { Authorization: "Bearer " + secret },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    // Never echo the Stripe body (or credentials) to logs or browser.
    throw new Error("Stripe finance read failed (HTTP " + response.status + ").");
  }
  const payload = await response.json();
  if (!payload || typeof payload !== "object") throw new Error("Invalid Stripe finance response.");
  return payload;
}

async function listAll(path, params, maxPages, options) {
  const data = [];
  let cursor = null;
  for (let page = 0; page < maxPages; page += 1) {
    const query = new URLSearchParams(params);
    query.set("limit", "100");
    if (cursor) query.set("starting_after", cursor);
    const result = await stripeGet(path, query, options);
    if (!Array.isArray(result.data)) throw new Error("Invalid Stripe finance list.");
    data.push(...result.data);
    if (!result.has_more) return { data, limited: false };
    cursor = result.data[result.data.length - 1]?.id;
    if (!cursor) throw new Error("Stripe finance pagination failed.");
  }
  return { data, limited: true };
}

function priceEstimate(subscription) {
  const items = subscription?.items?.data;
  if (!Array.isArray(items) || !items.length) return null;
  let amount = 0;
  let currency = null;
  let interval = null;
  for (const item of items) {
    const price = item?.price;
    const unit = price?.unit_amount;
    const quantity = Number(item?.quantity ?? 1);
    const itemCurrency = safeCurrency(price?.currency);
    const itemInterval = price?.recurring?.interval;
    // Usage-based, tiered or variable prices cannot be forecast from the list.
    if (price?.billing_scheme === "tiered" || price?.recurring?.usage_type === "metered" ||
        !Number.isInteger(unit) || !Number.isInteger(quantity) || quantity <= 0 ||
        !itemCurrency || !itemInterval || (currency && itemCurrency !== currency) ||
        (interval && itemInterval !== interval)) return null;
    currency = itemCurrency;
    interval = itemInterval;
    amount += unit * quantity;
  }
  return Number.isSafeInteger(amount) ? { amount, currency, interval } : null;
}

function normalizeSubscription(subscription, env, websiteNames) {
  const tier = tierFromSubscription(subscription, env);
  if (!tier || !Object.hasOwn(TIERS, tier)) return null;
  const customer = subscription?.customer && typeof subscription.customer === "object"
    ? subscription.customer : null;
  const status = String(subscription?.status || "unknown");
  const periodEnd = subscriptionPeriodEnd(subscription);
  const scheduledCancel = Boolean(subscription?.cancel_at_period_end || subscription?.cancel_at);
  const renewableStatus = status === "active" || status === "trialing" || status === "past_due";
  const autoRenew = renewableStatus && !scheduledCancel;
  const pricing = priceEstimate(subscription);
  return {
    subscriptionId: typeof subscription?.id === "string" ? subscription.id : null,
    player: websiteNames.get(String(subscription?.id)) || null,
    customer: customer?.name || null,
    email: customer?.email || null,
    tier: TIERS[tier].label,
    status,
    autoRenew,
    cancelAt: iso(subscription?.cancel_at) || (scheduledCancel ? iso(periodEnd) : null),
    periodEndAt: iso(periodEnd),
    trialEndsAt: status === "trialing" ? iso(subscription?.trial_end || periodEnd) : null,
    amount: pricing?.amount ?? null,
    currency: pricing?.currency || safeCurrency(subscription?.currency),
    interval: pricing?.interval || null,
    collectionMethod: subscription?.collection_method || null,
    createdAt: iso(subscription?.created),
  };
}

function normalizePayout(payout) {
  return {
    id: payout?.id || null,
    amount: Number.isSafeInteger(payout?.amount) ? payout.amount : null,
    currency: safeCurrency(payout?.currency),
    status: String(payout?.status || "unknown"),
    createdAt: iso(payout?.created),
    arrivalAt: iso(payout?.arrival_date),
    automatic: payout?.automatic === true,
    type: payout?.type || null,
  };
}

function normalizeBalance(balance) {
  const rows = [];
  for (const kind of ["available", "pending"]) {
    for (const item of Array.isArray(balance?.[kind]) ? balance[kind] : []) {
      if (Number.isSafeInteger(item?.amount) && safeCurrency(item?.currency)) {
        rows.push({ kind, currency: safeCurrency(item.currency), amount: item.amount });
      }
    }
  }
  return rows;
}

function summarize(subscriptions, payouts, now = Date.now()) {
  const deadline = now + 30 * 24 * 60 * 60 * 1000;
  const grossByCurrency = new Map();
  const upcoming = subscriptions.filter((s) => {
    const at = Date.parse(s.periodEndAt || "");
    return s.autoRenew && s.status === "active" && s.collectionMethod !== "send_invoice" &&
      Number.isFinite(at) && at >= now && at <= deadline;
  });
  for (const subscription of upcoming) {
    if (subscription.amount === null || !subscription.currency) continue;
    grossByCurrency.set(subscription.currency,
      (grossByCurrency.get(subscription.currency) || 0) + subscription.amount);
  }
  const outgoing = payouts.filter((p) => ["pending", "in_transit"].includes(p.status))
    .sort((a, b) => (Date.parse(a.arrivalAt) || Infinity) - (Date.parse(b.arrivalAt) || Infinity));
  return {
    subscriptions: subscriptions.length,
    active: subscriptions.filter((s) => s.status === "active" || s.status === "trialing").length,
    paymentAttention: subscriptions.filter((s) => ["past_due", "unpaid", "incomplete"].includes(s.status)).length,
    upcomingRenewals30Days: upcoming.length,
    estimatedRenewalGross30Days: [...grossByCurrency].map(([currency, amount]) => ({ currency, amount })),
    nextStripePayout: outgoing[0] || null,
  };
}

async function loadStripeFinance({
  env = process.env, fetchImpl = globalThis.fetch,
  websiteNames = new Map(), now = Date.now(),
} = {}) {
  const config = financeConfiguration(env);
  if (!config) {
    const error = new Error("Stripe finance reporting is not configured.");
    error.status = 503;
    throw error;
  }

  const options = { secret: config.secret, fetchImpl };
  const subParams = new URLSearchParams({ status: "all" });
  subParams.append("expand[]", "data.customer");

  const [subscriptionList, payoutList, balance] = await Promise.all([
    listAll("subscriptions", subParams, MAX_SUBSCRIPTION_PAGES, options),
    listAll("payouts", new URLSearchParams(), MAX_PAYOUT_PAGES, options),
    stripeGet("balance", null, options),
  ]);
  if (subscriptionList.limited) {
    // A partial subscriber list must never masquerade as a complete financial total.
    throw new Error("Stripe subscription list exceeds the supported reporting limit.");
  }

  const subscriptions = subscriptionList.data
    .map((s) => normalizeSubscription(s, env, websiteNames))
    .filter(Boolean)
    .sort((a, b) => String(a.periodEndAt || "9999").localeCompare(String(b.periodEndAt || "9999")));
  const payouts = payoutList.data.map(normalizePayout)
    .filter((p) => !p.type || p.type === "bank_account")
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

  return {
    asOf: new Date(now).toISOString(),
    mode: config.live ? "live" : "test",
    accountScope: "Stripe account balance and bank payouts; supporter renewals are Hollow Valley tiers only",
    subscriptions,
    payouts,
    balance: normalizeBalance(balance),
    payoutHistoryLimited: payoutList.limited,
    summary: summarize(subscriptions, payouts, now),
  };
}

module.exports = {
  financeConfiguration,
  loadStripeFinance,
  _test: { iso, priceEstimate, normalizeSubscription, normalizeBalance, normalizePayout, summarize },
};
