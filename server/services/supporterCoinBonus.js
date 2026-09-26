const { db } = require('../db');
const { normalizeTier } = require('./supporterTiers');

const MONTHLY_SUPPORTER_BONUS = Object.freeze({
  supporter: 15000,
  guardian: 20000,
  legend: 25000,
});

const ELIGIBLE_BILLING_REASONS = new Set([
  'subscription_create',
  'subscription_cycle',
]);

function normalizeId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && typeof value.id === 'string') return value.id;
  return null;
}

function invoiceSubscriptionId(invoice) {
  return normalizeId(
    invoice?.subscription ||
    invoice?.parent?.subscription_details?.subscription ||
    invoice?.lines?.data?.[0]?.parent?.subscription_item_details?.subscription
  );
}

function monthlyBonusAmount(tier) {
  return MONTHLY_SUPPORTER_BONUS[normalizeTier(tier)] || 0;
}

function isMonthlyBonusInvoice(invoice) {
  return ELIGIBLE_BILLING_REASONS.has(String(invoice?.billing_reason || '').trim());
}

function subscriberForSubscription(subscriptionId) {
  if (!subscriptionId) return null;
  return db.prepare(`
    SELECT
      s.user_id,
      s.tier,
      s.stripe_status,
      s.stripe_subscription_id,
      u.steam_id
    FROM supporter_subscriptions s
    JOIN users u ON u.id = s.user_id
    WHERE s.stripe_subscription_id = ?
    LIMIT 1
  `).get(subscriptionId) || null;
}

function automationConfig(env = process.env) {
  const baseUrl = String(env.AUTOMATION_SERVICE_URL || '').trim().replace(/\/$/, '');
  const token = String(env.HOLLOW_VALLEY_API_TOKEN || '').trim();
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error('AUTOMATION_SERVICE_URL is not configured');
  if (!token) throw new Error('HOLLOW_VALLEY_API_TOKEN is not configured');
  return { baseUrl, token };
}

async function creditMonthlySubscriberBonus(event, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (event?.type !== 'invoice.paid') return { skipped: true, reason: 'not-invoice-paid' };

  const invoice = event.data?.object || {};
  if (!isMonthlyBonusInvoice(invoice)) {
    return {
      skipped: true,
      reason: 'non-monthly-billing-reason',
      billingReason: invoice.billing_reason || null,
    };
  }

  const invoiceId = String(invoice.id || '').trim();
  if (!/^in_[A-Za-z0-9_]+$/.test(invoiceId)) {
    throw new Error('Stripe monthly supporter invoice is missing a valid invoice ID');
  }

  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) {
    throw new Error('Stripe monthly supporter invoice is missing a subscription ID');
  }

  const subscriber = subscriberForSubscription(subscriptionId);
  if (!subscriber) {
    const error = new Error('Stripe subscription is not linked to a Hollow Valley supporter account yet');
    error.code = 'SUPPORTER_BONUS_SUBSCRIPTION_NOT_LINKED';
    throw error;
  }

  const steamId = String(subscriber.steam_id || '').trim();
  if (!/^\d{17}$/.test(steamId)) {
    const error = new Error('Subscriber does not have a valid linked Steam account');
    error.code = 'SUPPORTER_BONUS_STEAM_NOT_LINKED';
    throw error;
  }

  const tier = normalizeTier(subscriber.tier);
  const amount = monthlyBonusAmount(tier);
  if (!tier || !amount) {
    throw new Error('Subscriber tier does not have a monthly Valley Coin bonus configured');
  }

  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
  const { baseUrl, token } = automationConfig(env);
  const response = await fetchImpl(`${baseUrl}/api/website/admin-wallet/supporter-bonus`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ steamId, tier, amount, invoiceId }),
  });

  let payload = null;
  try { payload = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(payload?.error || `Monthly supporter bonus request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }

  return {
    skipped: false,
    invoiceId,
    subscriptionId,
    userId: subscriber.user_id,
    steamId,
    tier,
    amount,
    duplicate: Boolean(payload?.duplicate),
    wallet: payload?.wallet || null,
    transaction: payload?.transaction || null,
  };
}

module.exports = {
  MONTHLY_SUPPORTER_BONUS,
  monthlyBonusAmount,
  isMonthlyBonusInvoice,
  invoiceSubscriptionId,
  subscriberForSubscription,
  creditMonthlySubscriberBonus,
};
