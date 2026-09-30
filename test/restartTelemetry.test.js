const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-restart-telemetry-'));
process.env.RESTART_TELEMETRY_PATH = path.join(tempDir, 'restart-telemetry.json');
const telemetry = require('../automation-platform/src/services/restartTelemetryService');

test('restart telemetry calculates the next Brisbane 12:01 boundary', () => {
  assert.equal(
    telemetry.nextRestartAt(new Date('2026-09-30T00:00:00.000Z')),
    '2026-09-30T02:01:00.000Z',
  );
  assert.equal(
    telemetry.nextRestartAt(new Date('2026-09-30T02:30:00.000Z')),
    '2026-09-30T14:01:00.000Z',
  );
});

test('restart telemetry records an in-progress run and promotes success to history', () => {
  const restartId = 'restart-test-001';
  telemetry.ingest({ restartId, event: 'warning_sent', at: '2026-09-30T01:51:00.000Z' });
  telemetry.ingest({ restartId, event: 'save_requested', at: '2026-09-30T02:00:50.000Z' });
  telemetry.ingest({ restartId, event: 'save_succeeded', at: '2026-09-30T02:00:51.000Z' });
  telemetry.ingest({ restartId, event: 'shutdown_requested', at: '2026-09-30T02:01:00.000Z' });
  telemetry.ingest({ restartId, event: 'process_exited', at: '2026-09-30T02:01:03.000Z' });
  telemetry.ingest({ restartId, event: 'process_started', at: '2026-09-30T02:02:04.000Z', details: { pid: 1234 } });
  telemetry.ingest({ restartId, event: 'rcon_online', at: '2026-09-30T02:02:40.000Z', details: { pid: 1234 } });

  const active = telemetry.getState(new Date('2026-09-30T02:02:41.000Z'));
  assert.equal(active.current.restartId, restartId);
  assert.equal(active.current.result, 'in_progress');
  assert.equal(active.current.events.at(-1).event, 'rcon_online');

  telemetry.ingest({
    restartId,
    event: 'success',
    at: '2026-09-30T02:02:41.000Z',
    message: 'Verified restart',
  });

  const done = telemetry.getState(new Date('2026-09-30T02:02:42.000Z'));
  assert.equal(done.current, null);
  assert.equal(done.lastRestart.restartId, restartId);
  assert.equal(done.lastRestart.result, 'success');
  assert.equal(done.lastRestart.message, 'Verified restart');
  assert.equal(done.lastRestart.events.at(-1).event, 'success');
});

test('restart telemetry rejects unsupported events', () => {
  assert.throws(
    () => telemetry.ingest({ restartId: 'restart-bad-001', event: 'pretend_success' }),
    /Unsupported restart telemetry event/,
  );
});

test('restart telemetry is carried on the already-authenticated BinaryLane CommandBridge route', () => {
  const route = read('automation-platform/src/routes/binaryLaneCommandBridgeRoutes.js');
  const presenceRoute = read('automation-platform/src/routes/presenceFeedRoutes.js');
  assert.match(route, /requireBinaryLaneCommandToken/);
  assert.match(route, /router\.post\('\/restart-event'/);
  assert.match(route, /restartTelemetry\.ingest/);
  assert.doesNotMatch(presenceRoute, /restart-event/);
});

test('Admin Hub exposes last, next and result restart evidence', () => {
  const status = read('automation-platform/src/services/statusService.js');
  const html = read('public/admin.html');
  const js = read('public/assets/admin-restart.js');

  assert.match(status, /restartTelemetry:\s*restartTelemetry\.getState\(\)/);
  assert.match(html, /admin-restart\.js\?v=1/);
  assert.match(js, /LAST RESTART/);
  assert.match(js, /NEXT RESTART/);
  assert.match(js, /RESTART RESULT/);
  assert.match(js, /12:01 AM \/ 12:01 PM/);
});

test('Windows restart script proves save, exit, relaunch and RCON before success', () => {
  const ps = read('scripts/windows/HollowValley-AutoRestart.ps1');
  for (const stage of [
    'warning_sent',
    'save_requested',
    'save_succeeded',
    'shutdown_requested',
    'process_exited',
    'process_started',
    'rcon_online',
    'success',
    'failure',
  ]) {
    assert.match(ps, new RegExp(`['\"]${stage}['\"]`));
  }
  assert.match(ps, /Password Accepted/);
  assert.match(ps, /TheIsleServer-Win64-Shipping/);
  assert.match(ps, /SAVE FAILED - restart aborted/);
  assert.match(ps, /Stop-Process -Force/);
  assert.match(ps, /Test-RconReady/);
  assert.doesNotMatch(ps, /\bStart-Process\b/);
  assert.doesNotMatch(ps, /StartHollowValley\.bat/);
});

test.after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});
