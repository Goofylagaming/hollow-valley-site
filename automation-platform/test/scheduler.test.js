const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

process.env.AUTOMATION_DB_PATH = path.join(os.tmpdir(), `hollow-valley-scheduler-${randomUUID()}.sqlite`);

const scheduler = require('../src/services/schedulerService');
const store = require('../src/services/automationStore');

test('scheduler validates dates and recurrence values', () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  assert.equal(scheduler.validateRunAt(future), future);
  assert.throws(() => scheduler.validateRunAt('not-a-date'), /valid scheduled date/i);
  assert.throws(() => scheduler.validateRunAt(new Date(Date.now() - 60_000).toISOString()), /future/i);
  assert.equal(scheduler.validateRecurrence('daily'), 'daily');
  assert.equal(scheduler.validateRecurrence('weekly'), 'weekly');
  assert.throws(() => scheduler.validateRecurrence('hourly'), /none, daily or weekly/i);
});

test('recurring jobs advance to the next future slot without replaying missed runs', () => {
  const now = Date.parse('2026-09-03T12:00:00.000Z');
  assert.equal(
    scheduler.nextRecurringRun('2026-09-01T00:00:00.000Z', 'daily', now),
    '2026-09-04T00:00:00.000Z'
  );
  assert.equal(
    scheduler.nextRecurringRun('2026-08-20T00:00:00.000Z', 'weekly', now),
    '2026-09-10T00:00:00.000Z'
  );
  assert.equal(scheduler.nextRecurringRun('2026-09-01T00:00:00.000Z', 'none', now), null);
});

test('interrupted jobs are recovered to scheduled state', () => {
  const id = randomUUID();
  store.createJob({
    id,
    type: 'discord_announcement',
    runAt: new Date(Date.now() + 60_000).toISOString(),
    payload: { message: 'Test' },
  });
  store.updateJob(id, { status: 'running', attempts: 1 });
  assert.equal(store.recoverInterruptedJobs(), 1);
  const recovered = store.getJob(id);
  assert.equal(recovered.status, 'scheduled');
  assert.match(recovered.last_error, /Recovered after service restart/);
});
