const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
process.env.AUTOMATION_SERVICE_URL = 'https://automation.example.test';
process.env.HOLLOW_VALLEY_API_TOKEN = 'test-website-token';

const { db } = require('../server/db');
const {
  MONTHLY_SUPPORTER_BONUS,
  monthlyBonusAmount,
  isMonthlyBonusInvoice,
  creditMonthlySubscriberBonus,
} = require('../server/services/supporterCoinBonus');

function reset({ tier = 'supporter' } = {}) {
  db.exec('DELETE FROM supporter_subscriptions; DELETE FROM users;');
  db.prepare('INSERT INTO users (id, username, steam_id) VALUES (?, ?, ?)')
    .run(42, 'subscriber-test', '76561198000000042');
  db.prepare(`
    INSERT INTO supporter_subscriptions (
      user_id, tier, auto_renew, renews_at, cancelled_at,
      stripe_customer_id, stripe_subscription_id, stripe_status
    ) VALUES (?, ?, 1, NULL, NULL, ?, ?, 'active')
  `).run(42, tier, 'cus_test_42', 'sub_test_42');
  db.exec("UPDATE supporter_subscriptions SET renews_at = '2099-01-01T00:00:00.000Z'");
}

function invoiceEvent({ id = 'in_test_001', billingReason = 'subscription_cycle' } = {}) {
  return {
    id: `evt_${id}`,
    type: 'invoice.paid',
    livemode: false,
    data: {
      object: {
        id,
        billing_reason: billingReason,
        parent: { subscription_details: { subscription: 'sub_test_42' } },
      },
    },
  };
}

test('monthly supporter bonus amounts are 15k, 20k and 25k', () => {
  assert.deepEqual(MONTHLY_SUPPORTER_BONUS, {
    supporter: 15000,
    guardian: 20000,
    legend: 25000,
  });
  assert.equal(monthlyBonusAmount('member'), 15000);
  assert.equal(monthlyBonusAmount('elite'), 20000);
  assert.equal(monthlyBonusAmount('legend'), 25000);
});

test('only subscription creation and normal cycles qualify for monthly bonus', () => {
  assert.equal(isMonthlyBonusInvoice({ billing_reason: 'subscription_create' }), true);
  assert.equal(isMonthlyBonusInvoice({ billing_reason: 'subscription_cycle' }), true);
  assert.equal(isMonthlyBonusInvoice({ billing_reason: 'subscription_update' }), false);
  assert.equal(isMonthlyBonusInvoice({ billing_reason: 'manual' }), false);
});

test('renewal credits the linked Steam wallet with the tier amount', async () => {
  reset({ tier: 'guardian' });
  let request = null;
  const fetchImpl = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return {
      ok: true,
      status: 201,
      async json() {
        return { ok: true, duplicate: false, wallet: { balance: 20000 } };
      },
    };
  };

  const result = await creditMonthlySubscriberBonus(invoiceEvent(), { fetchImpl });

  assert.equal(result.skipped, false);
  assert.equal(result.tier, 'guardian');
  assert.equal(result.amount, 20000);
  assert.equal(result.steamId, '76561198000000042');
  assert.equal(request.url, 'https://automation.example.test/api/website/admin-wallet/supporter-bonus');
  assert.equal(request.options.headers.Authorization, 'Bearer test-website-token');
  assert.deepEqual(request.body, {
    steamId: '76561198000000042',
    tier: 'guardian',
    amount: 20000,
    invoiceId: 'in_test_001',
  });
});

test('proration and upgrade invoices do not award another monthly bonus', async () => {
  reset({ tier: 'legend' });
  let called = false;
  const result = await creditMonthlySubscriberBonus(
    invoiceEvent({ billingReason: 'subscription_update' }),
    { fetchImpl: async () => { called = true; throw new Error('should not call'); } }
  );
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'non-monthly-billing-reason');
  assert.equal(called, false);
});

test('delayed paid invoice stays eligible with renewal off; expiry and cancellation block payouts', async () => {
  reset();
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: true, json: async () => ({ ok: true }) }; };
  db.prepare("UPDATE supporter_subscriptions SET auto_renew = 0, cancelled_at = datetime('now') WHERE user_id = 42").run();
  const ending = await creditMonthlySubscriberBonus(invoiceEvent({ id: 'in_paid_001' }), { fetchImpl });
  assert.equal(ending.skipped, false);
  assert.equal(ending.amount, 15000);
  assert.equal(calls, 1);
  db.prepare("UPDATE supporter_subscriptions SET renews_at = '2020-01-01T00:00:00Z' WHERE user_id = 42").run();
  assert.equal((await creditMonthlySubscriberBonus(invoiceEvent({ id: 'in_expired' }), { fetchImpl })).skipped, true);
  db.prepare("UPDATE supporter_subscriptions SET stripe_status = 'canceled', renews_at = '2099-01-01T00:00:00Z' WHERE user_id = 42").run();
  assert.equal((await creditMonthlySubscriberBonus(invoiceEvent({ id: 'in_cancelled' }), { fetchImpl })).skipped, true);
  assert.equal(calls, 1);
});
