const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadPresence({ snapshot, enabled = true } = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-presence-'));
  const dbPath = path.join(tempDir, 'presence.sqlite');
  const previousDb = process.env.AUTOMATION_DB_PATH;
  const previousEnabled = process.env.PLAYER_PRESENCE_ENABLED;
  process.env.AUTOMATION_DB_PATH = dbPath;
  process.env.PLAYER_PRESENCE_ENABLED = enabled ? 'true' : 'false';

  const statusPath = require.resolve('../src/services/statusService');
  const presencePath = require.resolve('../src/services/playerPresenceService');
  const originalStatus = require(statusPath);
  require.cache[statusPath].exports = {
    ...originalStatus,
    getServerSnapshot: async () => snapshot,
  };
  delete require.cache[presencePath];
  const presence = require(presencePath);

  return {
    presence,
    cleanup() {
      require.cache[statusPath].exports = originalStatus;
      delete require.cache[presencePath];
      if (previousDb === undefined) delete process.env.AUTOMATION_DB_PATH;
      else process.env.AUTOMATION_DB_PATH = previousDb;
      if (previousEnabled === undefined) delete process.env.PLAYER_PRESENCE_ENABLED;
      else process.env.PLAYER_PRESENCE_ENABLED = previousEnabled;
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

test('presence reconciliation opens, updates and closes sessions from successful snapshots', (t) => {
  const fixture = loadPresence({ snapshot: { configured: true, online: true, players: [], characters: [] } });
  t.after(fixture.cleanup);
  const p = fixture.presence;

  const first = p.reconcilePresence([
    { steamId: '76561198000000000', name: 'Alpha', species: 'Triceratops' },
    { steamId: '76561198000000001', name: 'Beta', species: 'Utahraptor' },
  ], '2026-09-18T00:00:00.000Z');
  assert.deepEqual(first, { opened: 2, updated: 0, closed: 0, online: 2 });

  const second = p.reconcilePresence([
    { steamId: '76561198000000000', name: 'Alpha', species: 'Triceratops' },
  ], '2026-09-18T00:01:00.000Z');
  assert.deepEqual(second, { opened: 0, updated: 1, closed: 1, online: 1 });

  const active = p.listSessions({ activeOnly: true });
  assert.equal(active.length, 1);
  assert.equal(active[0].steam_id, '76561198000000000');

  const all = p.listSessions({ limit: 10 });
  assert.equal(all.length, 2);
  assert.ok(all.some((row) => row.steam_id === '76561198000000001' && row.ended_at));
});

test('RCON outage skips reconciliation and leaves open sessions intact', async (t) => {
  const fixture = loadPresence({
    snapshot: { configured: true, online: false, players: [], characters: [], error: 'RCON timeout' },
  });
  t.after(fixture.cleanup);
  const p = fixture.presence;

  p.reconcilePresence([
    { steamId: '76561198000000000', name: 'Alpha', species: 'Triceratops' },
  ], '2026-09-18T00:00:00.000Z');

  const result = await p.samplePresence({ force: true });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'rcon-unavailable');
  assert.equal(p.listSessions({ activeOnly: true }).length, 1);
});

test('presence normalizes player list and character species without exposing locations', (t) => {
  const fixture = loadPresence({ snapshot: { configured: true, online: true, players: [], characters: [] } });
  t.after(fixture.cleanup);
  const p = fixture.presence;

  const result = p.normalizeOnline({
    players: [{ steamId: '76561198000000000', name: 'Alpha' }],
    characters: [{ steamId: '76561198000000000', species: 'Triceratops', location: { x: 1, y: 2, z: 3 } }],
  });
  assert.deepEqual(result, [{ steamId: '76561198000000000', name: 'Alpha', species: 'Triceratops' }]);
});
