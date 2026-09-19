const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relative) {
  return fs.readFileSync(path.join(__dirname, '..', '..', relative), 'utf8');
}

test('homepage wallet and quest browser script parses successfully', () => {
  const source = read('public/assets/site.js');
  assert.doesNotThrow(() => new Function(source));
});

test('wallet route uses Steam-linked automation economy', () => {
  const route = read('server/routes/wallet.js');
  assert.match(route, /automation\.getWallet/);
  assert.equal(route.includes('getWallet(req.user.id)'), false);
});

test('daily bonus route uses Steam-linked automation economy with no legacy wallet credit', () => {
  const route = read('server/routes/dailybonus.js');
  assert.match(route, /automation\.getDailyLoginBonus/);
  assert.match(route, /automation\.claimDailyLoginBonus/);
  assert.equal(route.includes('creditWallet'), false);
  assert.equal(route.includes('Math.random'), false);
});

test('quest route uses automatic verified-playtime quests and disables manual claims', () => {
  const route = read('server/routes/quests.js');
  assert.match(route, /automation\.getQuests/);
  assert.match(route, /status\(410\)/);
  assert.match(route, /complete automatically/i);
  assert.equal(route.includes('creditWallet'), false);
  assert.equal(route.includes('recordClaim'), false);
});

test('homepage no longer renders the wallet panel after dashboard consolidation', () => {
  const js = read('public/assets/site.js');
  const html = read('public/index.html');

  assert.equal(js.includes('wallet-base-rate'), false);
  assert.equal(js.includes('wallet-active-boost'), false);
  assert.equal(js.includes('wallet-current-payout'), false);
  assert.equal(js.includes('wallet-progress-fill'), false);
  assert.equal(html.includes('NEXT 5-MINUTE PAYOUT'), false);
  assert.equal(html.includes('RECENT WALLET ACTIVITY'), false);
  assert.equal(html.includes('DAILY LOGIN BONUS'), false);
});

test('homepage no longer renders quest progress panels or claim controls', () => {
  const js = read('public/assets/site.js');
  const html = read('public/index.html');

  assert.equal(js.includes('quest-claim'), false);
  assert.equal(js.includes('DAILY ACTIVITY'), false);
  assert.equal(js.includes('WEEKLY ACTIVITY'), false);
  assert.equal(html.includes('Verified online time completes these automatically'), false);
  assert.equal(html.includes('ACTIVE COIN BOOST'), false);
});

test('wallet activity labels marketplace sales refunds and skin preset spending', () => {
  const js = read('public/assets/site.js');
  assert.match(js, /marketplace_p2p_hold/);
  assert.match(js, /marketplace_p2p_refund/);
  assert.match(js, /marketplace_p2p_sale/);
  assert.match(js, /skin_preset_create/);
});
