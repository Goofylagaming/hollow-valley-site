const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadEconomy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-economy-'));
  const previous = process.env.AUTOMATION_DB_PATH;
  process.env.AUTOMATION_DB_PATH = path.join(dir, 'economy.sqlite');

  const storePath = require.resolve('../src/services/economyStore');
  delete require.cache[storePath];
  const store = require(storePath);

  return {
    store,
    cleanup() {
      delete require.cache[storePath];
      if (previous === undefined) delete process.env.AUTOMATION_DB_PATH;
      else process.env.AUTOMATION_DB_PATH = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('wallet ledger is idempotent and keeps non-negative balance', (t) => {
  const fixture = loadEconomy();
  t.after(fixture.cleanup);
  const { store } = fixture;
  const steamId = '76561198000000001';

  const first = store.applyWalletTransaction({
    steamId,
    amount: 100,
    kind: 'test_credit',
    reason: 'Test credit',
    idempotencyKey: 'credit:test:001',
  });
  assert.equal(first.wallet.balance, 100);
  assert.equal(first.duplicate, false);

  const duplicate = store.applyWalletTransaction({
    steamId,
    amount: 100,
    kind: 'test_credit',
    reason: 'Test credit',
    idempotencyKey: 'credit:test:001',
  });
  assert.equal(duplicate.wallet.balance, 100);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.wallet.transactions.length, 1);

  assert.throws(() => store.applyWalletTransaction({
    steamId,
    amount: -101,
    kind: 'test_debit',
    reason: 'Too much',
    idempotencyKey: 'debit:test:001',
  }), (error) => error.code === 'INSUFFICIENT_FUNDS');

  assert.equal(store.getWallet(steamId).balance, 100);
});

test('wallet follows Steam identity before website linkage', (t) => {
  const fixture = loadEconomy();
  t.after(fixture.cleanup);
  const { store } = fixture;
  const steamId = '76561198000000002';

  assert.equal(store.getWallet(steamId).balance, 0);
  store.applyWalletTransaction({
    steamId,
    amount: 25,
    kind: 'playtime_reward',
    reason: 'Online reward',
    idempotencyKey: 'playtime:test:001',
  });
  const wallet = store.getWallet(steamId);
  assert.equal(wallet.balance, 25);
  assert.equal(wallet.transactions[0].kind, 'playtime_reward');
});
