const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { randomUUID } = require('node:crypto');
process.env.DB_PATH = ':memory:';
process.env.OWNER_STEAM_ID = '76561198038977506';
process.env.HV_MANAGEMENT_ENABLED = '1';
process.env.HV_MANAGEMENT_WRITES_ENABLED = '1';
process.env.HV_MANAGEMENT_AGENT_TOKEN = 'isolated-test-token-for-growth-management-only';
const management = require('../server/services/serverManagement');
const growth = require('../server/services/persistentGrowth');
const { db } = require('../server/db');
const { requireFinanceOwner } = require('../server/middleware/requireFinanceOwner');
const { ownerRouter, agentRouter } = require('../server/routes/serverManagement');
const hash = 'a'.repeat(64);
function snapshot(extra = {}) {
  return { allowTaskWrites: true, server: { processCount: 1, pid: 123, rconOwnedByGame: true },
    tasks: { scheduled_restart: 'Ready' }, growth: { supported: true, writesEnabled: true,
      configHash: hash, configuredMultiplier: 3, state: 'unverified', ...extra } };
}
function reset() { db.exec('DELETE FROM hv_growth_jobs; DELETE FROM hv_management_status; DELETE FROM hv_management_jobs'); }
function request(extra = {}) { return { multiplier: 5, expectedHash: hash, requestId: randomUUID(), confirmation: 'SAVE 5X GROWTH', ownerSteamId: process.env.OWNER_STEAM_ID, ...extra }; }

test('persistent growth fails closed and deduplicates uncertain requests without exposing leases', () => {
  reset();
  assert.throws(() => growth.queue(request()), /offline/);
  management.receiveHeartbeat({ ...snapshot(), growth: undefined });
  assert.throws(() => growth.queue(request()), /update/);
  management.receiveHeartbeat(snapshot({ writesEnabled: false }));
  assert.throws(() => growth.queue(request()), /disabled/);
  management.receiveHeartbeat(snapshot());
  assert.throws(() => growth.queue(request({ ownerSteamId: '76561198000000000' })), /Owner/);
  assert.throws(() => growth.queue(request({ multiplier: 99 })), /Invalid/);
  assert.throws(() => growth.queue(request({ multiplier: '5' })), /Invalid/);
  assert.throws(() => growth.queue(request({ expectedHash: 'b'.repeat(64) })), /changed/);
  assert.throws(() => growth.queue(request({ confirmation: 'SAVE 3X GROWTH' })), /confirmation/);
  const payload = request();
  const job = growth.queue(payload);
  assert.equal(job.state, 'queued');
  assert.equal(job.leaseToken, undefined);
  assert.deepEqual(growth.queue(payload), job);
  assert.throws(() => growth.queue(request()), /pending/);
  assert.throws(() => growth.queue({ ...payload, multiplier: 3, confirmation: 'SAVE 3X GROWTH' }), /identity/);
  const leased = growth.lease();
  assert.equal(leased.multiplier, 5);
  assert.equal(leased.action, 'set_growth_config');
  assert.equal(leased.expectedHash, hash);
  assert.equal(growth.lease(), null);
  assert.throws(() => growth.complete({ ...leased, leaseToken: '0'.repeat(48), state: 'written' }), /lease/);
  db.prepare('UPDATE hv_growth_jobs SET claimed_at_ms=? WHERE id=?').run(Date.now() - 100_000, job.id);
  assert.equal(growth.overview().latestJob.state, 'unknown');
  assert.equal(growth.lease(), null);
  assert.throws(() => growth.queue(request()), /inspection/);
  // A delayed authentic result can reconcile unknown state; it does not execute again.
  growth.complete({ ...leased, state: 'written', message: 'Read-back verified; awaiting restart.' });
  assert.equal(growth.overview().canWrite, false, 'An old heartbeat cannot permit a second write after acknowledgment');
  assert.throws(() => growth.complete({ ...leased, state: 'written' }), /lease/);
  management.receiveHeartbeat(snapshot({ state: 'pending_restart', configuredMultiplier: 5, jobId: job.id }));
  assert.equal(growth.overview().canWrite, false);
  management.receiveHeartbeat(snapshot({ state: 'restart_observed', configuredMultiplier: 5, jobId: job.id }));
  assert.equal(growth.overview().gameplayVerified, false);
  assert.equal(growth.overview().canWrite, true);
});

test('stale status, concurrent restart and expired jobs cannot cause a write', () => {
  reset(); management.receiveHeartbeat(snapshot());
  const job = growth.queue(request());
  process.env.HV_MANAGEMENT_WRITES_ENABLED = '0';
  assert.equal(growth.lease(), null);
  process.env.HV_MANAGEMENT_WRITES_ENABLED = '1';
  management.receiveHeartbeat({ ...snapshot(), tasks: { scheduled_restart: 'Running' } });
  assert.equal(growth.lease(), null);
  management.receiveHeartbeat(snapshot());
  db.prepare('UPDATE hv_management_status SET received_at_ms=?').run(Date.now() - 100_000);
  assert.equal(growth.lease(), null);
  management.receiveHeartbeat(snapshot());
  db.prepare('UPDATE hv_growth_jobs SET created_at_ms=? WHERE id=?').run(Date.now() - 100_000, job.id);
  assert.equal(growth.lease(), null);
  assert.equal(growth.overview().latestJob.state, 'expired');
});

test('owner HTTP request traverses authenticated agent queue and result; ordinary admins and cross-origin requests cannot write', async t => {
  reset(); management.receiveHeartbeat(snapshot());
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { req.user = { steam_id: req.get('x-test-user'), is_admin: true }; next(); });
  app.use('/owner', requireFinanceOwner, ownerRouter); app.use('/agent', agentRouter);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'Content-Type': 'application/json', Origin: url, 'X-HV-Owner-Action': 'growth-config-v1', 'X-Test-User': process.env.OWNER_STEAM_ID };
  const payload = request(); delete payload.ownerSteamId;
  const post = h => fetch(url + '/owner/growth', { method: 'POST', headers: h, body: JSON.stringify(payload) });
  assert.equal((await post({ ...headers, 'X-Test-User': '76561198000000000' })).status, 404);
  assert.equal((await post({ ...headers, Origin: 'https://other.example' })).status, 403);
  assert.equal((await post({ ...headers, 'X-HV-Owner-Action': '' })).status, 403);
  const queued = await post(headers); assert.equal(queued.status, 202);
  assert.equal((await fetch(url + '/agent/next')).status, 401);
  const auth = { Authorization: 'Bearer ' + process.env.HV_MANAGEMENT_AGENT_TOKEN, 'Content-Type': 'application/json' };
  const leased = (await (await fetch(url + '/agent/next', { headers: auth })).json()).job;
  assert.equal(leased.multiplier, 5);
  assert.equal((await (await fetch(url + '/agent/next', { headers: auth })).json()).job, null);
  const ack = await fetch(`${url}/agent/growth/${leased.id}/result`, { method: 'POST', headers: auth, body: JSON.stringify({ leaseToken: leased.leaseToken, state: 'written', message: 'Verified on disk only' }) });
  assert.equal(ack.status, 200);
  const state = await (await fetch(url + '/owner/growth', { headers })).json();
  assert.equal(state.latestJob.state, 'written');
  assert.equal(state.latestJob.leaseToken, undefined);
  assert.equal(state.gameplayVerified, false);
});
