const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('old active Random Events migrate with NO ping and preserve all stored settings', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-species-ping-migration-'));
  const dbPath = path.join(directory, 'legacy.sqlite');
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(
    "CREATE TABLE species_coin_events (" +
      "id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, title TEXT NOT NULL," +
      "species_key TEXT NOT NULL, coins_per_minute INTEGER NOT NULL," +
      "starts_at_ms INTEGER NOT NULL, ends_at_ms INTEGER NOT NULL," +
      "status TEXT NOT NULL DEFAULT 'scheduled', created_by TEXT," +
      "auto_announce INTEGER NOT NULL DEFAULT 1," +
      "stopped_at_ms INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))" +
    ")"
  );
  const id = 'bc56ed42-ea15-4c18-b254-a457509e0cc4';
  const start = Date.parse('2026-11-01T00:00:00Z');
  const end = start + 60 * 60 * 1000;
  legacy.prepare(
    "INSERT INTO species_coin_events " +
    "(id, request_id, title, species_key, coins_per_minute, starts_at_ms, ends_at_ms, created_by, auto_announce) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, '034c69d2-9169-466b-a41b-98fb334e52de', 'PT Test',
    'pteranodon', 300, start, end, '76561198038977506', 1);
  legacy.close();

  const originalPath = process.env.AUTOMATION_DB_PATH;
  const originalGate = process.env.SPECIES_COIN_EVENTS_ENABLED;
  process.env.AUTOMATION_DB_PATH = dbPath;
  process.env.SPECIES_COIN_EVENTS_ENABLED = 'true';

  const events = require('../src/services/speciesCoinEventService');
  const economy = require('../src/services/economyStore');
  t.after(() => {
    economy.db.close();
    if (originalPath === undefined) delete process.env.AUTOMATION_DB_PATH;
    else process.env.AUTOMATION_DB_PATH = originalPath;
    if (originalGate === undefined) delete process.env.SPECIES_COIN_EVENTS_ENABLED;
    else process.env.SPECIES_COIN_EVENTS_ENABLED = originalGate;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const fields = economy.db.prepare('PRAGMA table_info(species_coin_events)').all();
  assert.ok(fields.some(field => field.name === 'ping_mode'));
  assert.ok(fields.some(field => field.name === 'announce_route'));
  assert.ok(fields.some(field => field.name === 'species_bonuses_json'), 'additive multi-species field exists');
  const current = events.listEvents({ nowMs: start + 1000 }).events[0];
  assert.equal(current.id, id);
  assert.equal(current.title, 'PT Test');
  assert.equal(current.coinsPerMinute, 300);
  assert.deepEqual(current.speciesBonuses, [{ species: 'pteranodon', coinsPerMinute: 300 }]);
  assert.equal(current.isMultiSpecies, false);
  assert.equal(current.speciesCount, 1);
  assert.equal(economy.db.prepare('SELECT species_bonuses_json FROM species_coin_events WHERE id = ?').get(id).species_bonuses_json, null);
  assert.equal(current.pingMode, 'none');
  assert.equal(current.announceRoute, 'legacy', 'old Random Events retain their original channels');
  assert.equal(current.autoAnnounce, true);
  assert.equal(current.status, 'active');
  assert.equal(economy.db.prepare("SELECT ping_mode FROM species_coin_events WHERE id = ?").get(id).ping_mode, 'none');
  assert.equal(economy.db.prepare("SELECT announce_route FROM species_coin_events WHERE id = ?").get(id).announce_route, 'legacy');

  const oldToken = process.env.HERBYBOT_AUTOMATION_TOKEN;
  process.env.HERBYBOT_AUTOMATION_TOKEN = 'migration-test-bridge';
  try {
    const outbox = require('../src/services/automationStore');
    events.reconcileAnnouncements({ nowMs: start + 1000 });
    const first = outbox.listOutboxEvents({ limit: 50 })
      .filter(row => row.nonce.includes(id));
    assert.deepEqual(first.map(row => row.destination), ['announcement', 'progress']);
    assert.equal(first.length, 2);
    events.reconcileAnnouncements({ nowMs: start + 2000 });
    const second = outbox.listOutboxEvents({ limit: 50 })
      .filter(row => row.nonce.includes(id));
    assert.equal(second.length, 2, 'a channel migration must not duplicate an old start');
  } finally {
    if (oldToken === undefined) delete process.env.HERBYBOT_AUTOMATION_TOKEN;
    else process.env.HERBYBOT_AUTOMATION_TOKEN = oldToken;
  }
});
