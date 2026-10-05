const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

process.env.AUTOMATION_DB_PATH = path.join(os.tmpdir(), `hollow-valley-territory-discord-${randomUUID()}.sqlite`);

const relay = require('../src/services/territoryWarDiscordService');

function createHarness() {
  let saved = null;
  let payload = null;
  const queued = [];
  const env = {
    TERRITORY_WARS_DISCORD_ENABLED: 'true',
    TERRITORY_WARS_STATE_URL: 'https://preview.example.test/api/territory-wars/state',
    TERRITORY_WARS_MAP_URL: 'https://preview.example.test/groups/territory-wars/',
  };
  const storeApi = {
    getState(_key, fallback) {
      return saved ? { value: saved } : fallback;
    },
    setState(_key, value) {
      saved = value;
      return { value };
    },
  };
  const outbox = {
    configured: () => true,
    queueTerritoryWar(message, { nonce } = {}) {
      const existing = queued.find((entry) => entry.nonce === nonce);
      if (existing) return existing;
      const entry = { message, nonce, destination: 'territory-war' };
      queued.push(entry);
      return entry;
    },
  };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => payload,
  });

  return {
    env,
    storeApi,
    outbox,
    fetchImpl,
    queued,
    get saved() { return saved; },
    setPayload(value) { payload = value; },
  };
}

function state(log, overrides = {}) {
  return {
    event: {
      id: 42,
      territory_name: 'South Plains',
      owner_name: 'Admin',
      challenger_name: 'Ridge Runners',
      status: 'live',
      ...overrides,
    },
    log,
  };
}

test('Territory Wars Discord relay primes existing history then queues only new meaningful logs once', async () => {
  const harness = createHarness();
  harness.setPayload(state([
    { id: 1, kind: 'created', message: 'Event created' },
    { id: 2, kind: 'status', message: 'Event started automatically at the scheduled time.' },
  ]));

  const primed = await relay.pollOnce(harness);
  assert.equal(primed.primed, true);
  assert.equal(primed.queued, 0);
  assert.equal(harness.queued.length, 0);
  assert.equal(harness.saved.eventId, 42);
  assert.equal(harness.saved.lastLogId, 2);

  harness.setPayload(state([
    { id: 1, kind: 'created', message: 'Event created' },
    { id: 2, kind: 'status', message: 'Event started automatically at the scheduled time.' },
    { id: 3, kind: 'attack', message: 'Ridge Runners declared an attack. Five-minute warning started.' },
    { id: 4, kind: 'kill', message: 'Hunter defeated Guard inside South Plains Battlefield.' },
    { id: 5, kind: 'capture', message: 'Ridge Runners captured South Plains. Territory protected for 10 minutes.' },
  ]));

  const relayed = await relay.pollOnce(harness);
  assert.equal(relayed.primed, false);
  assert.equal(relayed.checked, 3);
  assert.equal(relayed.queued, 2);
  assert.equal(harness.queued.length, 2);
  assert.deepEqual(harness.queued.map((entry) => entry.nonce), [
    'territory:42:log:3',
    'territory:42:log:5',
  ]);
  assert.match(harness.queued[0].message, /ATTACK — SOUTH PLAINS/);
  assert.match(harness.queued[1].message, /SOUTH PLAINS CAPTURED/);
  assert.equal(harness.saved.lastLogId, 5);

  const repeated = await relay.pollOnce(harness);
  assert.equal(repeated.queued, 0);
  assert.equal(harness.queued.length, 2);
});

test('Territory Wars kill relay stays opt-in and uses deterministic nonces when enabled', async () => {
  const harness = createHarness();
  harness.setPayload(state([{ id: 10, kind: 'created', message: 'Event created' }]));
  await relay.pollOnce(harness);

  harness.env.TERRITORY_WARS_DISCORD_KILLS = 'true';
  harness.setPayload(state([
    { id: 10, kind: 'created', message: 'Event created' },
    { id: 11, kind: 'kill', message: 'Hunter defeated Guard inside South Plains Battlefield.' },
  ]));
  const result = await relay.pollOnce(harness);

  assert.equal(result.queued, 1);
  assert.equal(harness.queued[0].nonce, 'territory:42:log:11');
  assert.match(harness.queued[0].message, /SOUTH PLAINS BATTLEFIELD/);
});

test('a newly observed event is primed instead of replaying its existing history', async () => {
  const harness = createHarness();
  harness.setPayload(state([{ id: 1, kind: 'status', message: 'Old war started.' }]));
  await relay.pollOnce(harness);

  harness.setPayload(state([
    { id: 20, kind: 'status', message: 'New war started.' },
    { id: 21, kind: 'attack', message: 'Attack already underway.' },
  ], { id: 43, owner_name: 'Valley Guard' }));
  const result = await relay.pollOnce(harness);

  assert.equal(result.primed, true);
  assert.equal(result.queued, 0);
  assert.equal(harness.saved.eventId, 43);
  assert.equal(harness.saved.lastLogId, 21);
});
