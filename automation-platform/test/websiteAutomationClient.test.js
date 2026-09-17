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

test('website client keeps the integration token server-side and sends it as bearer auth', async () => {
  await withEnv({
    AUTOMATION_SERVICE_URL: 'https://automation.example.test',
    HOLLOW_VALLEY_API_TOKEN: 'website-secret',
  }, async () => {
    const client = loadClient();
    let request;
    const fetchImpl = async (url, options) => {
      request = { url, options };
      return response(200, { steamId: '76561198000000000', dinos: [] });
    };

    const result = await client.listStoredDinos('76561198000000000', { fetchImpl });
    assert.deepEqual(result.dinos, []);
    assert.equal(request.url, 'https://automation.example.test/api/website/dinostorage/76561198000000000');
    assert.equal(request.options.headers.Authorization, 'Bearer website-secret');
  });
});

test('website client rejects invalid player-controlled identifiers before making a request', async () => {
  await withEnv({
    AUTOMATION_SERVICE_URL: 'https://automation.example.test',
    HOLLOW_VALLEY_API_TOKEN: 'website-secret',
  }, async () => {
    const client = loadClient();
    let called = false;
    const fetchImpl = async () => { called = true; return response(200, {}); };

    assert.throws(() => client.requestBodyDrop({ steamId: 'bad', dropType: 'small' }, { fetchImpl }), /Steam ID/);
    assert.throws(() => client.requestDinoAction('store', { steamId: '76561198000000000', slot: '../bad' }, { fetchImpl }), /slot/);
    assert.equal(called, false);
  });
});

test('website client preserves automation HTTP errors for the live backend to handle', async () => {
  await withEnv({
    AUTOMATION_SERVICE_URL: 'https://automation.example.test',
    HOLLOW_VALLEY_API_TOKEN: 'website-secret',
  }, async () => {
    const client = loadClient();
    const fetchImpl = async () => response(429, { error: 'Body drop is still on cooldown', cooldown: { active: true } });

    await assert.rejects(
      () => client.requestBodyDrop({ steamId: '76561198000000000', dropType: 'small' }, { fetchImpl }),
      (error) => error.status === 429 && error.payload?.cooldown?.active === true
    );
  });
});

test('status polling only reads request state and stops on an unknown outcome', async () => {
  await withEnv({
    AUTOMATION_SERVICE_URL: 'https://automation.example.test',
    HOLLOW_VALLEY_API_TOKEN: 'website-secret',
  }, async () => {
    const client = loadClient();
    const statuses = ['queued', 'acknowledged', 'unknown'];
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url, method: options.method });
      const status = statuses.shift() || 'unknown';
      return response(200, { request: { id: 'request_12345678', status } });
    };

    const result = await client.waitForRequestStatus('request_12345678', '76561198000000000', {
      fetchImpl,
      intervalMs: 250,
      maxWaitMs: 2000,
    });

    assert.equal(result.terminal, true);
    assert.equal(result.requiresOperator, true);
    assert.equal(result.request.status, 'unknown');
    assert.equal(calls.length, 3);
    assert.ok(calls.every((entry) => entry.method === 'GET'));
  });
});
