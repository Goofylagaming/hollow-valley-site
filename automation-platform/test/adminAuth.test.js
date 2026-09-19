const test = require('node:test');
const assert = require('node:assert/strict');
const { requireAdminToken } = require('../src/middleware/adminAuth');

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function request(headers = {}) {
  const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return { get(name) { return normalized[String(name).toLowerCase()] || undefined; } };
}

test('admin write API stays disabled when no token is configured', () => {
  const previous = process.env.AUTOMATION_ADMIN_TOKEN;
  delete process.env.AUTOMATION_ADMIN_TOKEN;
  const res = response();
  let called = false;
  requireAdminToken(request(), res, () => { called = true; });
  assert.equal(called, false);
  assert.equal(res.statusCode, 503);
  if (previous === undefined) delete process.env.AUTOMATION_ADMIN_TOKEN;
  else process.env.AUTOMATION_ADMIN_TOKEN = previous;
});

test('admin token rejects invalid credentials and accepts bearer token', () => {
  const previous = process.env.AUTOMATION_ADMIN_TOKEN;
  process.env.AUTOMATION_ADMIN_TOKEN = 'test-secret-value';

  const denied = response();
  let deniedNext = false;
  requireAdminToken(request({ authorization: 'Bearer wrong-value' }), denied, () => { deniedNext = true; });
  assert.equal(deniedNext, false);
  assert.equal(denied.statusCode, 401);

  const allowed = response();
  let allowedNext = false;
  requireAdminToken(request({ authorization: 'Bearer test-secret-value' }), allowed, () => { allowedNext = true; });
  assert.equal(allowedNext, true);
  assert.equal(allowed.statusCode, 200);

  if (previous === undefined) delete process.env.AUTOMATION_ADMIN_TOKEN;
  else process.env.AUTOMATION_ADMIN_TOKEN = previous;
});
