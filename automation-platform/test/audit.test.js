const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

process.env.AUTOMATION_DB_PATH = path.join(os.tmpdir(), `hollow-valley-audit-${randomUUID()}.sqlite`);

const audit = require('../src/services/auditService');
const store = require('../src/services/automationStore');

test('audit sanitizer redacts secret-shaped fields recursively', () => {
  const result = audit.sanitize({
    token: 'secret-token',
    nested: {
      password: 'secret-password',
      safe: 'visible',
    },
    list: [{ authorization: 'Bearer nope' }],
  });
  assert.equal(result.token, '[redacted]');
  assert.equal(result.nested.password, '[redacted]');
  assert.equal(result.nested.safe, 'visible');
  assert.equal(result.list[0].authorization, '[redacted]');
});

test('audit service persists success and failure without secrets', async () => {
  const success = await audit.run('rcon', 'save', { token: 'hidden', safe: true }, async () => ({ confirmed: true }),
    (value) => ({ confirmed: value.confirmed }));
  assert.deepEqual(success, { confirmed: true });

  const rows = store.listAudit({ limit: 10 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].category, 'rcon');
  assert.equal(rows[0].action, 'save');
  assert.equal(rows[0].status, 'succeeded');
  assert.equal(rows[0].details.token, '[redacted]');
  assert.equal(rows[0].details.confirmed, true);

  await assert.rejects(
    () => audit.run('discord', 'announce', { secret: 'hidden' }, async () => { throw new Error('Discord unavailable'); }),
    /Discord unavailable/
  );
  const failed = store.listAudit({ statuses: ['failed'], limit: 10 });
  assert.equal(failed.length, 1);
  assert.equal(failed[0].details.secret, '[redacted]');
  assert.equal(failed[0].message, 'Discord unavailable');
});
