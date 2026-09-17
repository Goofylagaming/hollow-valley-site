const test = require('node:test');
const assert = require('node:assert/strict');
const { requireWebsiteToken } = require('../src/middleware/websiteAuth');

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

function restore(name, previous) {
  if (previous === undefined) delete process.env[name];
  else process.env[name] = previous;
}

test('website integration API fails closed when no website token is configured', () => {
  const previous = process.env.HOLLOW_VALLEY_API_TOKEN;
  delete process.env.HOLLOW_VALLEY_API_TOKEN;

  const res = response();
  let called = false;
  requireWebsiteToken(request(), res, () => { called = true; });

  assert.equal(called, false);
  assert.equal(res.statusCode, 503);
  assert.match(res.body.error, /disabled/i);
  restore('HOLLOW_VALLEY_API_TOKEN', previous);
});

test('website integration uses its own bearer token and rejects the wrong credential', () => {
  const previous = process.env.HOLLOW_VALLEY_API_TOKEN;
  process.env.HOLLOW_VALLEY_API_TOKEN = 'website-only-secret';

  const denied = response();
  let deniedNext = false;
  requireWebsiteToken(request({ authorization: 'Bearer operator-admin-token' }), denied, () => { deniedNext = true; });
  assert.equal(deniedNext, false);
  assert.equal(denied.statusCode, 401);

  const allowed = response();
  let allowedNext = false;
  requireWebsiteToken(request({ authorization: 'Bearer website-only-secret' }), allowed, () => { allowedNext = true; });
  assert.equal(allowedNext, true);
  assert.equal(allowed.statusCode, 200);

  restore('HOLLOW_VALLEY_API_TOKEN', previous);
});

test('website integration also accepts the dedicated x-hollow-valley-token header', () => {
  const previous = process.env.HOLLOW_VALLEY_API_TOKEN;
  process.env.HOLLOW_VALLEY_API_TOKEN = 'website-header-secret';

  const res = response();
  let called = false;
  requireWebsiteToken(request({ 'x-hollow-valley-token': 'website-header-secret' }), res, () => { called = true; });

  assert.equal(called, true);
  assert.equal(res.statusCode, 200);
  restore('HOLLOW_VALLEY_API_TOKEN', previous);
});
