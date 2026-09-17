const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadHistory(enabled = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-health-'));
  const dbPath = path.join(dir, 'health.sqlite');
  const previousDb = process.env.AUTOMATION_DB_PATH;
  const previousEnabled = process.env.SERVER_HEALTH_HISTORY_ENABLED;
  process.env.AUTOMATION_DB_PATH = dbPath;
  process.env.SERVER_HEALTH_HISTORY_ENABLED = enabled ? 'true' : 'false';
  const modulePath = require.resolve('../src/services/serverHealthHistoryService');
  delete require.cache[modulePath];
  const service = require(modulePath);
  return {
    service,
    cleanup() {
      delete require.cache[modulePath];
      if (previousDb === undefined) delete process.env.AUTOMATION_DB_PATH;
      else process.env.AUTOMATION_DB_PATH = previousDb;
      if (previousEnabled === undefined) delete process.env.SERVER_HEALTH_HISTORY_ENABLED;
      else process.env.SERVER_HEALTH_HISTORY_ENABLED = previousEnabled;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('health history classifies coarse failure causes without storing raw errors', (t) => {
  const fixture = loadHistory();
  t.after(fixture.cleanup);
  const h = fixture.service;
  assert.equal(h.classifyError('RCON response timeout'), 'timeout');
  assert.equal(h.classifyError('authentication failed'), 'auth');
  assert.equal(h.classifyError('ECONNREFUSED'), 'refused');
  assert.equal(h.classifyError('something internal with secret details'), 'unavailable');
});

test('health analytics calculate availability and player metrics from samples', (t) => {
  const fixture = loadHistory();
  t.after(fixture.cleanup);
  const h = fixture.service;

  h.recordSample({ online: true, playerCount: 10, maxPlayers: 100, checkedAt: '2026-09-18T00:00:00.000Z' });
  h.recordSample({ online: true, playerCount: 20, maxPlayers: 100, checkedAt: '2026-09-18T00:10:00.000Z' });
  h.recordSample({ online: false, playerCount: 0, maxPlayers: 100, error: 'RCON response timeout', checkedAt: '2026-09-18T00:20:00.000Z' });
  h.recordSample({ online: false, playerCount: 0, maxPlayers: 100, error: 'RCON response timeout', checkedAt: '2026-09-18T00:30:00.000Z' });
  h.recordSample({ online: true, playerCount: 30, maxPlayers: 100, checkedAt: '2026-09-18T00:40:00.000Z' });

  const analytics = h.getHealthAnalytics({ hours: 24, nowMs: Date.parse('2026-09-18T01:00:00.000Z') });
  assert.equal(analytics.samples, 5);
  assert.equal(analytics.onlineSamples, 3);
  assert.equal(analytics.availabilityPercent, 60);
  assert.equal(analytics.averagePlayers, 20);
  assert.equal(analytics.peakPlayers, 30);
  assert.equal(analytics.maxPlayers, 100);
  assert.equal(analytics.outageTransitions, 1);
  assert.deepEqual(analytics.errors, { timeout: 2 });
});

test('disabled history reports disabled without requiring live RCON', async (t) => {
  const fixture = loadHistory(false);
  t.after(fixture.cleanup);
  const result = await fixture.service.sampleServerHealth();
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'disabled');
});
