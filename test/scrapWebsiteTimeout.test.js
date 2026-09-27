const test = require('node:test');
const assert = require('node:assert/strict');

const client = require('../server/services/automationWebsiteClient');

test('scrap keeps the website request open for the list and delete confirmations', async (t) => {
  const saved = {
    url: process.env.AUTOMATION_SERVICE_URL,
    token: process.env.HOLLOW_VALLEY_API_TOKEN,
    timeout: process.env.AUTOMATION_SERVICE_TIMEOUT_MS,
  };
  process.env.AUTOMATION_SERVICE_URL = 'https://automation.example';
  process.env.HOLLOW_VALLEY_API_TOKEN = 'test-token';
  process.env.AUTOMATION_SERVICE_TIMEOUT_MS = '8000';
  t.after(() => {
    for (const [key, value] of [
      ['AUTOMATION_SERVICE_URL', saved.url],
      ['HOLLOW_VALLEY_API_TOKEN', saved.token],
      ['AUTOMATION_SERVICE_TIMEOUT_MS', saved.timeout],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  let scheduledMs;
  t.mock.method(global, 'setTimeout', (_callback, ms) => {
    scheduledMs = ms;
    return { unref() {} };
  });
  t.mock.method(global, 'fetch', async (url, options) => {
    assert.equal(url, 'https://automation.example/api/website/dinostorage/scrap');
    assert.equal(options.method, 'POST');
    assert.equal(JSON.parse(options.body).slot, 'slot1');
    return { ok: true, json: async () => ({ ok: true }) };
  });
  assert.equal((await client.scrapStoredDino({ steamId: '76561198000000000', slot: 'slot1' })).ok, true);
  assert.equal(scheduledMs, 25000);
});
