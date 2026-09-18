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
  assert.match(route, /automationRoutes\.getWallet/);
  assert.equal(route.includes('getWallet(req.user.id)'), false);
});

test('quest route uses automatic verified-playtime quests and disables manual claims', () => {
  const route = read('server/routes/quests.js');
  assert.match(route, /automationRoutes\.getQuests/);
  assert.match(route, /status\(410\)/);
  assert.match(route, /complete automatically/i);
  assert.equal(route.includes('creditWallet'), false);
  assert.equal(route.includes('recordClaim'), false);
});

test('homepage wallet renders five-minute earning rate progress and active boost', () => {
  const js = read('public/assets/site.js');
  const html = read('public/index.html');

  assert.match(js, /wallet-base-rate/);
  assert.match(js, /wallet-active-boost/);
  assert.match(js, /wallet-current-payout/);
  assert.match(js, /wallet-progress-fill/);
  assert.match(js, /nextRewardInSeconds/);
  assert.match(html, /NEXT 5-MINUTE PAYOUT/);
  assert.match(html, /RECENT WALLET ACTIVITY/);
});

test('homepage quests render automatic daily and weekly progress with no claim buttons', () => {
  const js = read('public/assets/site.js');
  const html = read('public/index.html');

  assert.match(js, /DAILY ACTIVITY/);
  assert.match(js, /WEEKLY ACTIVITY/);
  assert.match(js, /progressSeconds/);
  assert.match(js, /boostPercent/);
  assert.equal(js.includes('quest-claim'), false);
  assert.equal(js.includes('Claiming…'), false);
  assert.match(html, /Verified online time completes these automatically/);
  assert.match(html, /ACTIVE COIN BOOST/);
});

test('wallet activity labels marketplace sales refunds and skin preset spending', () => {
  const js = read('public/assets/site.js');
  assert.match(js, /marketplace_p2p_hold/);
  assert.match(js, /marketplace_p2p_refund/);
  assert.match(js, /marketplace_p2p_sale/);
  assert.match(js, /skin_preset_create/);
});
