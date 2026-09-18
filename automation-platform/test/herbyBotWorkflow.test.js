const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

process.env.AUTOMATION_DB_PATH = path.join(os.tmpdir(), `hollow-valley-herbybot-workflow-${randomUUID()}.sqlite`);
process.env.HERBYBOT_AUTOMATION_TOKEN = 'herbybot-workflow-secret';
process.env.SERVER_MONITOR_ENABLED = 'true';
process.env.SERVER_MONITOR_FAILURE_THRESHOLD = '3';

const store = require('../src/services/automationStore');
const scheduler = require('../src/services/schedulerService');

test('due scheduled announcement is durably queued for HerbyBot', async () => {
  const id = randomUUID();
  const job = store.createJob({
    id,
    type: 'discord_announcement',
    runAt: new Date(Date.now() - 1000).toISOString(),
    recurrence: 'none',
    payload: { message: 'Scheduled Hollow Valley announcement' },
  });

  const result = await scheduler.executeJob(job);
  assert.equal(result.status, 'completed');

  const events = store.listOutboxEvents({ limit: 50 });
  const event = events.find((item) => item.nonce === id);
  assert.ok(event);
  assert.equal(event.destination, 'announcement');
  assert.equal(event.status, 'pending');
  assert.equal(event.message, 'Scheduled Hollow Valley announcement');
});

test('server monitor queues one outage alert and one recovery alert through HerbyBot', async (t) => {
  const statusPath = require.resolve('../src/services/statusService');
  const monitorPath = require.resolve('../src/services/serverMonitorService');
  const originalStatus = require(statusPath);
  let online = false;

  require.cache[statusPath].exports = {
    ...originalStatus,
    getServerSnapshot: async () => ({
      configured: true,
      online,
      players: online ? [{ steamId: '76561198000000001', name: 'Test' }] : [],
      characters: [],
      maxPlayers: 100,
      error: online ? null : 'RCON unavailable',
    }),
  };
  delete require.cache[monitorPath];
  const monitor = require(monitorPath);

  t.after(() => {
    require.cache[statusPath].exports = originalStatus;
    delete require.cache[monitorPath];
  });

  store.deleteState('server_monitor');

  await monitor.checkServerMonitor({ force: true });
  await monitor.checkServerMonitor({ force: true });
  const third = await monitor.checkServerMonitor({ force: true });
  assert.equal(third.transition, 'offline');
  assert.equal(third.alerted, true);

  let alerts = store.listOutboxEvents({ limit: 100 }).filter((event) => event.destination === 'alert');
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].message, /marked offline/i);

  const stableOffline = await monitor.checkServerMonitor({ force: true });
  assert.equal(stableOffline.transition, null);
  alerts = store.listOutboxEvents({ limit: 100 }).filter((event) => event.destination === 'alert');
  assert.equal(alerts.length, 1);

  online = true;
  const recovered = await monitor.checkServerMonitor({ force: true });
  assert.equal(recovered.transition, 'recovered');
  assert.equal(recovered.alerted, true);

  alerts = store.listOutboxEvents({ limit: 100 }).filter((event) => event.destination === 'alert');
  assert.equal(alerts.length, 2);
  assert.match(alerts[1].message, /recovered/i);
});
