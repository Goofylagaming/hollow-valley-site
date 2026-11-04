"use strict";

const { liveModeEnabled } = require("./supporterCheckout");

function ref(value) { return typeof value === "string" ? value : value?.id || null; }

async function verifyInvoiceFunding(invoice, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const live = liveModeEnabled(env);
  const secret = String(env.STRIPE_SECRET_KEY || "");
  if (!(live ? /^(sk|rk)_live_/ : /^(sk|rk)_test_/).test(secret)) throw new Error("Membership payment verification is not configured");
  async function get(path) {
    const response = await fetchImpl(`https://api.stripe.com/v1${path}`, {
      headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("Membership payment verification is unavailable");
    return response.json();
  }
  const references = new Set();
  const charges = new Map();
  async function charge(value) {
    const chargeId = ref(value);
    if (!/^ch_[A-Za-z0-9_]+$/.test(chargeId || "")) return false;
    const item = typeof value === "object" && typeof value.refunded === "boolean" ? value : await get(`/charges/${encodeURIComponent(chargeId)}`);
    if (item?.id !== chargeId || item.livemode !== live || item.paid !== true ||
        !Number.isFinite(item.amount) || !Number.isFinite(item.amount_refunded)) return false;
    references.add(`charge:${chargeId}`);
    if (ref(item.payment_intent)) references.add(`payment_intent:${ref(item.payment_intent)}`);
    charges.set(chargeId, item);
    return true;
  }
  async function intent(value) {
    const intentId = ref(value);
    if (!/^pi_[A-Za-z0-9_]+$/.test(intentId || "")) return false;
    references.add(`payment_intent:${intentId}`);
    const item = typeof value === "object" && value.latest_charge ? value :
      await get(`/payment_intents/${encodeURIComponent(intentId)}?expand%5B%5D=latest_charge`);
    if (item?.id !== intentId || item.livemode !== live) return false;
    return charge(item.latest_charge);
  }
  let verified = false;
  if (invoice.charge) verified = await charge(invoice.charge);
  else if (invoice.payment_intent) verified = await intent(invoice.payment_intent);
  else {
    // New Stripe versions associate an invoice with InvoicePayment objects.
    const payments = await get(`/invoice_payments?invoice=${encodeURIComponent(invoice.id)}&status=paid&limit=100`);
    if (!Array.isArray(payments?.data) || payments.has_more || !payments.data.length) {
      return { verified: false, reason: "payment-history-incomplete", references: [] };
    }
    verified = true;
    for (const payment of payments.data) {
      if (ref(payment.invoice) !== invoice.id || payment.livemode !== live || payment.status !== "paid") { verified = false; break; }
      const details = payment.payment;
      const okay = details?.type === "charge" ? await charge(details.charge) :
        details?.type === "payment_intent" ? await intent(details.payment_intent) : false;
      if (!okay) { verified = false; break; }
    }
  }
  if (!verified || !charges.size) return { verified: false, reason: "payment-reference-unverified", references: [...references] };
  const list = [...charges.values()];
  const netPaid = list.reduce((total, value) => total + Math.max(0, value.amount - value.amount_refunded), 0);
  return { verified: true, revoked: netPaid <= 0 || list.some(value => value.disputed === true), references: [...references] };
}

module.exports = { verifyInvoiceFunding };
