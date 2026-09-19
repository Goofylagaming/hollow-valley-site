const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

process.env.AUTOMATION_DB_PATH = path.join(os.tmpdir(), `hollow-valley-monitor-${randomUUID()}.sqlite`);

const monitor = require('../src/services/serverMonitorService');
const store = require('../src/services/automationStore');

test('monitor requires consecutive failures before confirming offline', () => {
  const first = monitor.nextMonitorState({}, false, 3, '2026-09-18T00:00:00.000Z');
  assert.equal(first.transition, null);
  assert.equal(first.state.confirmed, null);
  assert.equal(first.state.consecutiveFailures, 1);

  const second = monitor.nextMonitorState(first.state, false, 3, '2026-09-18T00:01:00.000Z');
  assert.equal(second.transition, null);
  assert.equal(second.state.consecutiveFailures, 2);

  const third = monitor.nextMonitorState(second.state, false, 3, '2026-09-18T00:02:00.000Z');
  assert.equal(third.transition, 'offline');
  assert.equal(third.state.confirmed, 'offline');
  assert.equal(third.state.consecutiveFailures, 3);
});

test('monitor emits one recovery transition and resets failure count', () => {
  const offline = {
    confirmed: 'offline',
    consecutiveFailures: 5,
    lastChangedAt: '2026-09-18T00:02:00.000Z',
  };
  const recovered = monitor.nextMonitorState(offline, true, 3, '2026-09-18T00:03:00.000Z');
  assert.equal(recovered.transition, 'recovered');
  assert.equal(recovered.state.confirmed, 'online');
  assert.equal(recovered.state.consecutiveFailures, 0);

  const stable = monitor.nextMonitorState(recovered.state, true, 3, '2026-09-18T00:04:00.000Z');
  assert.equal(stable.transition, null);
  assert.equal(stable.state.confirmed, 'online');
});

test('persistent state survives service-level reads', () => {
  store.setState('server_monitor', {
    confirmed: 'offline',
    consecutiveFailures: 3,
    lastAlertAt: '2026-09-18T00:02:00.000Z',
  });
  const state = store.getState('server_monitor');
  assert.equal(state.value.confirmed, 'offline');
  assert.equal(state.value.consecutiveFailures, 3);
  assert.equal(state.value.lastAlertAt, '2026-09-18T00:02:00.000Z');
});
