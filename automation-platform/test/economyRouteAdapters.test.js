const test = require('node:test');
const assert = require('node:assert/strict');

function loadWithClientStubs(stubs = {}) {
  const clientPath = require.resolve('../integration/websiteAutomationClient');
  const adapterPath = require.resolve('../integration/liveRouteAdapters');
  const originalClient = require(clientPath);
  require.cache[clientPath].exports = { ...originalClient, ...stubs };
  delete require.cache[adapterPath];
  const adapters = require(adapterPath);
  return {
    adapters,
    restore() {
      require.cache[clientPath].exports = originalClient;
      delete require.cache[adapterPath];
    },
  };
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('wallet adapter derives Steam identity from authenticated backend user', async (t) => {
  let seen = null;
  const fixture = loadWithClientStubs({
    getWallet: async (steamId) => {
      seen = steamId;
      return { balance: 120, transactions: [{ amount: 10, kind: 'playtime_reward' }] };
    },
  });
  t.after(fixture.restore);

  const res = response();
  await fixture.adapters.getWallet({
    user: { steam_id: '76561198000000011' },
    query: { steamId: '76561198999999999' },
  }, res);

  assert.equal(seen, '76561198000000011');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.balance, 120);
  assert.equal(res.body.steamLinked, true);
});

test('unlinked wallet read returns zero without contacting automation', async (t) => {
  let calls = 0;
  const fixture = loadWithClientStubs({
    getWallet: async () => { calls += 1; return {}; },
  });
  t.after(fixture.restore);

  const res = response();
  await fixture.adapters.getWallet({ user: { steam_id: null } }, res);
  assert.equal(calls, 0);
  assert.deepEqual(res.body, { balance: 0, transactions: [], steamLinked: false });
});

test('marketplace catalog adapter preserves current frontend catalog shape', async (t) => {
  const fixture = loadWithClientStubs({
    listMarketplaceCatalog: async () => ({
      catalog: [{
        id: 'dino:carno:75',
        item_type: 'dino',
        name: 'Carnotaurus 75%',
        price: 400,
        payload: { speciesId: 'carnotaurus', sizePercent: 75 },
      }],
    }),
  });
  t.after(fixture.restore);

  const res = response();
  await fixture.adapters.listMarketplaceCatalog({}, res);
  assert.deepEqual(res.body, [{
    id: 'dino:carno:75',
    species_id: 'carnotaurus',
    price: 400,
    size_percent: 75,
    name: 'Carnotaurus 75%',
    item_type: 'dino',
  }]);
});

test('marketplace buy uses authenticated Steam identity and backend-generated idempotency key', async (t) => {
  let input = null;
  const fixture = loadWithClientStubs({
    purchaseMarketplaceItem: async (value) => {
      input = value;
      return {
        duplicate: false,
        order: { id: 'order-1', status: 'pending' },
        wallet: { balance: 600 },
      };
    },
  });
  t.after(fixture.restore);

  const res = response();
  await fixture.adapters.buyMarketplaceCatalogItem({
    user: { steam_id: '76561198000000012' },
  }, res, 'dino:carno:75');

  assert.equal(input.steamId, '76561198000000012');
  assert.equal(input.catalogId, 'dino:carno:75');
  assert.match(input.idempotencyKey, /^website-marketplace:/);
  assert.equal(res.statusCode, 202);
  assert.equal(res.body.accepted, true);
  assert.equal(res.body.fulfilled, false);
  assert.equal(res.body.order.status, 'pending');
});


test('quest adapter derives Steam identity and exposes automatic boost progress', async (t) => {
  let seen = null;
  const fixture = loadWithClientStubs({
    getQuests: async (steamId) => {
      seen = steamId;
      return {
        activeBoostPercent: 25,
        quests: [{
          id: 'daily-total-3h',
          title: 'Three Hour Survivor',
          cadence: 'daily',
          thresholdSeconds: 10800,
          progressSeconds: 10800,
          completed: true,
          boostPercent: 15,
        }],
      };
    },
  });
  t.after(fixture.restore);

  const res = response();
  await fixture.adapters.getQuests({
    user: { steam_id: '76561198000000013' },
  }, res);

  assert.equal(seen, '76561198000000013');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.steamLinked, true);
  assert.equal(res.body.activeBoostPercent, 25);
  assert.equal(res.body.quests[0].claimed, true);
  assert.equal(res.body.quests[0].rewardType, 'playtime_boost_percent');
  assert.equal(res.body.quests[0].reward, null);
});

test('unlinked quest read returns harmless empty state without automation call', async (t) => {
  let calls = 0;
  const fixture = loadWithClientStubs({
    getQuests: async () => { calls += 1; return {}; },
  });
  t.after(fixture.restore);

  const res = response();
  await fixture.adapters.getQuests({ user: { steam_id: null } }, res);
  assert.equal(calls, 0);
  assert.deepEqual(res.body, {
    steamLinked: false,
    activeBoostPercent: 0,
    quests: [],
  });
});
