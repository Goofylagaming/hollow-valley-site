const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

process.env.AUTOMATION_DB_PATH = ':memory:';
process.env.SPECIES_COIN_EVENTS_ENABLED = 'true';
const wallet = require('../src/services/economyStore');
const events = require('../src/services/speciesCoinEventService');

const T0 = Date.parse('2026-11-01T09:00:00.000Z');
const player = '76561198000000218';
const other = '76561198000000219';
function reset() {
  wallet.db.exec('DELETE FROM species_coin_event_progress; DELETE FROM species_coin_events; DELETE FROM economy_wallet_ledger; DELETE FROM economy_wallets;');
}
function create(override = {}, nowMs = T0) {
  return events.createEvent({
    requestId: randomUUID(),
    title: 'Omniraptor Spotlight',
    species: 'omniraptor',
    coinsPerMinute: 50,
    durationMinutes: 60,
    actorSteamId: '76561198038977506',
    ...override,
  }, { nowMs });
}
function snapshot(nowMs, species = 'Omniraptor', steamId = player) {
  return events.processSnapshot([{ steamId, species }], { nowMs });
}
function balance(id = player) { return wallet.getWallet(id).balance; }

test('timed species events require a deliberate feature gate and validate limits', () => {
  reset();
  assert.throws(() => create({ coinsPerMinute: 5001 }), /Bonus must/);
  assert.throws(() => create({ durationMinutes: 0 }), /duration/);
  assert.throws(() => create({ growthMultiplier: 2 }), /growth overrides/);
  assert.throws(() => create({ species: 'not a playable path /' }), /species/);
  assert.throws(() => create({ actorSteamId: 'bad' }), /Steam-linked/);
  const old = process.env.SPECIES_COIN_EVENTS_ENABLED;
  delete process.env.SPECIES_COIN_EVENTS_ENABLED;
  try {
    assert.throws(() => create(), /disabled/);
    assert.deepEqual(events.processSnapshot([{ steamId: player, species: 'Omniraptor' }], { nowMs: T0 }), {
      skipped: true, reason: 'disabled', intervals: 0, coins: 0,
    });
  } finally { process.env.SPECIES_COIN_EVENTS_ENABLED = old; }
});

test('event creation is idempotent and rejects same-species overlapping events', () => {
  reset();
  const id = randomUUID();
  const initial = create({ requestId: id });
  assert.equal(initial.event.status, 'active');
  assert.equal(initial.duplicate, false);
  const retry = create({ requestId: id }, T0 + 120000);
  assert.equal(retry.duplicate, true, 'Start now retries reuse the initial start time');
  assert.equal(retry.event.id, initial.event.id);
  assert.throws(() => create({ requestId: id, coinsPerMinute: 51 }, T0 + 120000), /different event settings/);
  assert.throws(() => create(), /overlapping bonus/);
  assert.equal(create({ species: 'Triceratops' }).event.species, 'triceratops');
});

test('verified species play earns one bonus per completed minute exactly once', () => {
  reset();
  const { event } = create();
  const players = (species) => [{ steamId: player, species }];
  const first = events.processSnapshot(players('Omniraptor'), { nowMs: T0 });
  assert.equal(first.intervals, 0);
  assert.equal(snapshot(T0 + 30000).intervals, 0);
  assert.equal(snapshot(T0 + 60000).intervals, 1);
  assert.equal(balance(), 50);
  assert.equal(snapshot(T0 + 60000).intervals, 0, 'replayed timestamp cannot pay twice');
  assert.equal(snapshot(T0 + 120000).intervals, 1);
  assert.equal(balance(), 100);
  const ledger = wallet.getWallet(player).transactions;
  assert.equal(ledger.length, 2);
  assert.ok(ledger.every(row => row.kind === 'species_event_bonus'));
  assert.ok(ledger.every(row => row.metadata.supporterMultiplierApplied === false));
  assert.ok(ledger.every(row => row.reference_id === event.id));
  assert.equal(snapshot(T0 + 150000, 'Triceratops').intervals, 0);
  assert.equal(snapshot(T0 + 180000, 'Omniraptor').intervals, 0, 'changing species must reset reward streak');
  assert.equal(snapshot(T0 + 240000, 'Omniraptor').intervals, 1);
  assert.equal(balance(), 150);
  assert.equal(snapshot(T0 + 300000, 'Unknown').coins, 0);
  assert.equal(balance(), 150);
  assert.equal(snapshot(T0 + 360000, 'Omniraptor').coins, 0);
  assert.equal(snapshot(T0 + 420000, 'Omniraptor').coins, 50);
  assert.equal(balance(), 200);
});

test('stale player snapshots, offline gaps and expired windows never create catch-up payouts', () => {
  reset();
  create({ durationMinutes: 5 });
  snapshot(T0);
  assert.equal(snapshot(T0 + 120000).coins, 0, 'two-minute presence gap must reset reward streak');
  assert.equal(snapshot(T0 + 180000).coins, 50);
  assert.equal(snapshot(T0 + 240000).coins, 50);
  const before = balance();
  assert.equal(snapshot(T0 + 600000).coins, 0, 'event is expired and no backpay is possible');
  assert.equal(balance(), before);
});

test('admin can stop events instantly without deleting prior wallet credits', () => {
  reset();
  const { event } = create();
  snapshot(T0);
  snapshot(T0 + 60000);
  assert.equal(balance(), 50);
  const stopped = events.stopEvent(event.id, { nowMs: T0 + 60001 });
  assert.equal(stopped.event.status, 'stopped');
  assert.equal(events.stopEvent(event.id).duplicate, true);
  assert.equal(snapshot(T0 + 120000).coins, 0);
  assert.equal(balance(), 50);
  assert.equal(events.listEvents({ nowMs: T0 + 120000 }).events[0].status, 'stopped');
});

test('unmatched dinosaur and player IDs never create wallet credits', () => {
  reset();
  create();
  events.processSnapshot([{ steamId: 'invalid', species: 'Omniraptor' }, { steamId: other, species: 'Triceratops' }], { nowMs: T0 });
  events.processSnapshot([{ steamId: other, species: 'Triceratops' }], { nowMs: T0 + 60000 });
  assert.equal(wallet.getWallet(other).balance, 0);
});

test('HerbyBot receives idempotent start and stop messages for opted-in events', () => {
  reset();
  const previous = process.env.HERBYBOT_AUTOMATION_TOKEN;
  process.env.HERBYBOT_AUTOMATION_TOKEN = 'species-test-herbybot';
  const outbox = require('../src/services/automationStore');
  try {
    const { event } = create({ title: 'First 60-Minute Raptor Hour' });
    const before = outbox.getOutboxSummary().total;
    const initial = events.reconcileAnnouncements({ nowMs: T0 + 1000 });
    assert.equal(initial.skipped, false);
    assert.equal(outbox.getOutboxSummary().total, before + 2);
    events.reconcileAnnouncements({ nowMs: T0 + 3000 });
    assert.equal(outbox.getOutboxSummary().total, before + 2, 'same notification cannot be double-queued');
    events.stopEvent(event.id, { nowMs: T0 + 60000 });
    events.reconcileAnnouncements({ nowMs: T0 + 61000 });
    assert.equal(outbox.getOutboxSummary().total, before + 4);
    events.reconcileAnnouncements({ nowMs: T0 + 63000 });
    assert.equal(outbox.getOutboxSummary().total, before + 4, 'stop notice is idempotent');

    create({ title: 'Silent Event', species: 'Triceratops', autoAnnounce: false });
    events.reconcileAnnouncements({ nowMs: T0 + 65000 });
    assert.equal(outbox.getOutboxSummary().total, before + 4);
  } finally {
    if (previous === undefined) delete process.env.HERBYBOT_AUTOMATION_TOKEN;
    else process.env.HERBYBOT_AUTOMATION_TOKEN = previous;
  }
});

test('one missing authoritative presence sample prevents all offline event accrual', () => {
  reset();
  create({ coinsPerMinute: 65 });
  snapshot(T0);
  assert.equal(snapshot(T0 + 30_000).coins, 0);
  // During a 20s offline gap, the player is missing from an authoritative
  // RCON presence sample. The minute accrual must immediately reset.
  events.processSnapshot([], { nowMs: T0 + 50_000 });
  assert.equal(snapshot(T0 + 70_000).coins, 0);
  assert.equal(snapshot(T0 + 110_000).coins, 0);
  assert.equal(snapshot(T0 + 130_000).coins, 65);
  assert.equal(balance(), 65);
  assert.equal(snapshot(T0 + 130_000).coins, 0);
});
