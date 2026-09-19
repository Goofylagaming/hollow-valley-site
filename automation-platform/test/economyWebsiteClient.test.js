const test = require('node:test');
const assert = require('node:assert/strict');

function loadClient() {
  const path = require.resolve('../integration/websiteAutomationClient');
  delete require.cache[path];
  return require(path);
}

function withEnv(values, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve().then(fn).finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

test('website economy client reads Steam-keyed wallet through protected backend API', async () => {
  await withEnv({
    AUTOMATION_SERVICE_URL: 'https://automation.example.test',
    HOLLOW_VALLEY_API_TOKEN: 'website-secret',
  }, async () => {
    const client = loadClient();
    let request;
    const fetchImpl = async (url, options) => {
      request = { url, options };
      return response(200, { balance: 50, transactions: [] });
    };

    const wallet = await client.getWallet('76561198000000010', { fetchImpl });
    assert.equal(wallet.balance, 50);
    assert.equal(request.url, 'https://automation.example.test/api/website/wallet/76561198000000010');
    assert.equal(request.options.headers.Authorization, 'Bearer website-secret');
  });
});

test('website economy client sends purchase idempotency key server-to-server', async () => {
  await withEnv({
    AUTOMATION_SERVICE_URL: 'https://automation.example.test',
    HOLLOW_VALLEY_API_TOKEN: 'website-secret',
  }, async () => {
    const client = loadClient();
    let request;
    const fetchImpl = async (url, options) => {
      request = { url, options };
      return response(201, { ok: true, order: { id: 'order-1', status: 'pending' }, wallet: { balance: 600 } });
    };

    const result = await client.purchaseMarketplaceItem({
      steamId: '76561198000000010',
      catalogId: 'dino:carno:75',
      idempotencyKey: 'website-marketplace:test-001',
    }, { fetchImpl });

    assert.equal(result.order.status, 'pending');
    assert.equal(request.url, 'https://automation.example.test/api/website/marketplace/catalog/dino%3Acarno%3A75/buy');
    assert.equal(request.options.method, 'POST');
    assert.deepEqual(JSON.parse(request.options.body), {
      steamId: '76561198000000010',
      idempotencyKey: 'website-marketplace:test-001',
    });
  });
});

test('website economy client rejects invalid marketplace identifiers before fetch', async () => {
  await withEnv({
    AUTOMATION_SERVICE_URL: 'https://automation.example.test',
    HOLLOW_VALLEY_API_TOKEN: 'website-secret',
  }, async () => {
    const client = loadClient();
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return response(200, {}); };

    assert.throws(() => client.purchaseMarketplaceItem({
      steamId: 'bad',
      catalogId: 'dino:carno:75',
      idempotencyKey: 'website-marketplace:test-002',
    }, { fetchImpl }), /Steam ID/);

    assert.throws(() => client.purchaseMarketplaceItem({
      steamId: '76561198000000010',
      catalogId: '../bad',
      idempotencyKey: 'website-marketplace:test-003',
    }, { fetchImpl }), /catalog ID/);

    assert.equal(calls, 0);
  });
});
