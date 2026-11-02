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
    const startNotices = outbox.listOutboxEvents({ limit: 500 }).filter(entry =>
      entry.nonce.includes(event.id) && entry.nonce.includes('-start-'));
    assert.equal(startNotices.length, 2);
    for (const notice of startNotices) {
      assert.match(notice.message, /Ends at 01-11-2026 20:00 \(QLD time\)\./);
      assert.doesNotMatch(notice.message, /2026-11-01T10:00:00\.000Z/);
    }
    events.reconcileAnnouncements({ nowMs: T0 + 3000 });
    assert.equal(outbox.getOutboxSummary().total, before + 2, 'same notification cannot be double-queued');
    events.stopEvent(event.id, { nowMs: T0 + 60000 });
    events.reconcileAnnouncements({ nowMs: T0 + 61000 });
    assert.equal(outbox.getOutboxSummary().total, before + 4);
    const stopNotices = outbox.listOutboxEvents({ limit: 500 }).filter(entry =>
      entry.nonce.includes(event.id) && entry.nonce.includes('-end-'));
    assert.equal(stopNotices.length, 2);
    for (const notice of stopNotices) {
      assert.match(notice.message, /Ended at 01-11-2026 19:01 \(QLD time\)\./);
    }
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

test('Random Event pings are opt-in, start-only, and never duplicate by nonce', () => {
  reset();
  const previous = process.env.HERBYBOT_AUTOMATION_TOKEN;
  process.env.HERBYBOT_AUTOMATION_TOKEN = 'role-mention-test';
  const outbox = require('../src/services/automationStore');
  try {
    const first = create({ title: 'Pteranodon Test', species: 'pteranodon', pingMode: 'community' });
    const second = create({ title: 'Raptor Test', species: 'omniraptor', pingMode: 'everyone' });
    const silent = create({ title: 'Triceratops Test', species: 'triceratops' });

    const all = () => outbox.listOutboxEvents({ limit: 500 });
    events.reconcileAnnouncements({ nowMs: T0 + 1000 });
    const forId = (id) => all().filter(row => row.nonce.includes(id));

    assert.deepEqual(
      forId(first.event.id).map(row => row.nonce).sort(),
      [
        'hv-species-event-' + first.event.id + '-start-announcement-ping-community',
        'hv-species-event-' + first.event.id + '-start-progress',
      ]
    );
    assert.deepEqual(
      forId(second.event.id).map(row => row.nonce).sort(),
      [
        'hv-species-event-' + second.event.id + '-start-announcement-ping-everyone',
        'hv-species-event-' + second.event.id + '-start-progress',
      ]
    );
    assert.deepEqual(
      forId(silent.event.id).map(row => row.nonce).sort(),
      [
        'hv-species-event-' + silent.event.id + '-start-announcement',
        'hv-species-event-' + silent.event.id + '-start-progress',
      ]
    );
    const count = all().length;
    events.reconcileAnnouncements({ nowMs: T0 + 2000 });
    assert.equal(all().length, count, 'same start cannot queue two pings');

    events.stopEvent(first.event.id, { nowMs: T0 + 60_000 });
    events.reconcileAnnouncements({ nowMs: T0 + 61_000 });
    const ending = forId(first.event.id).filter(row => row.nonce.includes('-end-'));
    assert.equal(ending.length, 2);
    assert.ok(ending.every(row => !row.nonce.includes('ping-')));
  } finally {
    if (previous === undefined) delete process.env.HERBYBOT_AUTOMATION_TOKEN;
    else process.env.HERBYBOT_AUTOMATION_TOKEN = previous;
  }
});

test('bad ping targets are denied; event replay must not change ping target', () => {
  reset();
  assert.throws(() => create({ pingMode: 'all' }), /no ping, Community Member, or everyone/);
  assert.throws(() => create({ autoAnnounce: false, pingMode: 'community' }), /require automatic announcements/);
  const id = randomUUID();
  const initial = create({ requestId: id, pingMode: 'community' });
  assert.equal(initial.event.pingMode, 'community');
  assert.equal(create({ requestId: id, pingMode: 'community' }, T0 + 20_000).duplicate, true);
  assert.throws(() => create({ requestId: id, pingMode: 'everyone' }, T0 + 20_000), /different event settings/);
});

test('one event pays different rates to two dinosaur species, with independent minute receipts', () => {
  reset();
  const { event } = create({
    title: 'Carnivore Bonus Hour',
    speciesBonuses: [
      { species: 'pteranodon', coinsPerMinute: 500 },
      { species: 'omniraptor', coinsPerMinute: 300 },
    ],
  });
  assert.equal(event.isMultiSpecies, true);
  assert.equal(event.speciesCount, 2);
  assert.deepEqual(event.speciesBonuses, [
    { species: 'omniraptor', coinsPerMinute: 300 },
    { species: 'pteranodon', coinsPerMinute: 500 },
  ]);
  const both = [
    { steamId: player, species: 'Omniraptor' },
    { steamId: other, species: 'Pteranodon' },
  ];
  assert.equal(events.processSnapshot(both, { nowMs: T0 }).coins, 0);
  assert.equal(events.processSnapshot(both, { nowMs: T0 + 30_000 }).coins, 0);
  const payout = events.processSnapshot(both, { nowMs: T0 + 60_000 });
  assert.equal(payout.coins, 800);
  assert.equal(payout.intervals, 2);
  assert.equal(wallet.getWallet(player).balance, 300);
  assert.equal(wallet.getWallet(other).balance, 500);
  assert.equal(events.processSnapshot(both, { nowMs: T0 + 60_000 }).coins, 0);
  assert.equal(wallet.getWallet(player).transactions[0].metadata.species, 'omniraptor');
  assert.equal(wallet.getWallet(other).transactions[0].metadata.species, 'pteranodon');
});

test('switching between two eligible dinosaurs resets the event minute streak and keeps a unique receipt sequence', () => {
  reset();
  const { event } = create({
    speciesBonuses: [
      { species: 'omniraptor', coinsPerMinute: 300 },
      { species: 'pteranodon', coinsPerMinute: 500 },
    ],
  });
  const observe = (time, species) => events.processSnapshot(
    [{ steamId: player, species }], { nowMs: time });
  observe(T0, 'Omniraptor');
  assert.equal(observe(T0 + 60_000, 'Omniraptor').coins, 300);
  assert.equal(observe(T0 + 90_000, 'Pteranodon').coins, 0, 'species change breaks the minute');
  assert.equal(observe(T0 + 120_000, 'Pteranodon').coins, 0);
  assert.equal(observe(T0 + 150_000, 'Pteranodon').coins, 500);
  assert.equal(observe(T0 + 150_000, 'Pteranodon').coins, 0);
  assert.equal(wallet.getWallet(player).balance, 800);
  const receipts = wallet.getWallet(player).transactions;
  assert.equal(receipts.length, 2);
  assert.deepEqual(new Set(receipts.map(r => r.idempotency_key)).size, 2);
  assert.ok(receipts.every(r => r.reference_id === event.id));
});

test('every species in a grouped event blocks overlapping bonuses, not just the first', () => {
  reset();
  create({
    speciesBonuses: [
      { species: 'omniraptor', coinsPerMinute: 300 },
      { species: 'pteranodon', coinsPerMinute: 500 },
    ],
  });
  assert.throws(() => create({ species: 'pteranodon', coinsPerMinute: 30 }), /overlapping bonus/);
  assert.throws(() => create({
    speciesBonuses: [
      { species: 'triceratops', coinsPerMinute: 200 },
      { species: 'pteranodon', coinsPerMinute: 100 },
    ],
  }), /overlapping bonus/);
  const unrelated = create({ species: 'Triceratops', coinsPerMinute: 200 });
  assert.equal(unrelated.event.species, 'triceratops');
  assert.equal(unrelated.event.speciesBonuses.length, 1);
});

test('group requests validate rate limits, duplicate species and idempotent reordering', () => {
  reset();
  assert.throws(() => create({ speciesBonuses: [] }), /Choose between/);
  assert.throws(() => create({ speciesBonuses: 'omniraptor' }), /Choose between/);
  assert.throws(() => create({ speciesBonuses: [
    { species: 'omniraptor', coinsPerMinute: 50 },
    { species: 'Omniraptor', coinsPerMinute: 100 },
  ] }), /more than once/);
  assert.throws(() => create({ speciesBonuses: [
    { species: 'omniraptor', coinsPerMinute: 50 },
    { species: 'not_a_dino', coinsPerMinute: 100 },
  ] }), /valid dinosaur/);
  assert.throws(() => create({ speciesBonuses: [
    { species: 'omniraptor', coinsPerMinute: 50.5 },
  ] }), /whole number/);
  assert.throws(() => create({ speciesBonuses: [
    { species: 'omniraptor', coinsPerMinute: 1001 },
  ] }), /whole number/);

  const requestId = randomUUID();
  const base = [
    { species: 'pteranodon', coinsPerMinute: 150 },
    { species: 'omniraptor', coinsPerMinute: 90 },
  ];
  const first = create({ requestId, speciesBonuses: base });
  const retry = create({ requestId, speciesBonuses: [...base].reverse() }, T0 + 40_000);
  assert.equal(first.event.id, retry.event.id);
  assert.equal(retry.duplicate, true);
  assert.throws(() => create({ requestId, speciesBonuses: [
    { species: 'pteranodon', coinsPerMinute: 150 },
    { species: 'omniraptor', coinsPerMinute: 91 },
  ] }, T0 + 40_000), /different event settings/);
});

test('grouped events queue one combined start and one end announcement, even on retries', () => {
  reset();
  const prior = process.env.HERBYBOT_AUTOMATION_TOKEN;
  process.env.HERBYBOT_AUTOMATION_TOKEN = 'multi-species-outbox-test';
  const store = require('../src/services/automationStore');
  try {
    const { event } = create({
      title: 'Featured Dinosaur Hour',
      speciesBonuses: [
        { species: 'omniraptor', coinsPerMinute: 300 },
        { species: 'pteranodon', coinsPerMinute: 200 },
        { species: 'triceratops', coinsPerMinute: 500 },
      ],
      pingMode: 'community',
    });
    const matching = () => store.listOutboxEvents({ limit: 500 })
      .filter(row => row.nonce.includes(event.id));
    events.reconcileAnnouncements({ nowMs: T0 + 1000 });
    assert.equal(matching().length, 1);
    assert.equal(matching()[0].destination, 'announcement');
    assert.match(matching()[0].message, /omniraptor \+300 VC\/min/);
    assert.match(matching()[0].message, /pteranodon \+200 VC\/min/);
    assert.match(matching()[0].message, /triceratops \+500 VC\/min/);
    assert.match(matching()[0].message, /Ends at 01-11-2026 20:00 \(QLD time\)/);
    assert.ok(matching()[0].nonce.endsWith('-start-announcement-ping-community'));
    events.reconcileAnnouncements({ nowMs: T0 + 2000 });
    assert.equal(matching().length, 1);
    events.stopEvent(event.id, { nowMs: T0 + 120_000 });
    events.reconcileAnnouncements({ nowMs: T0 + 121_000 });
    assert.equal(matching().length, 2);
    assert.equal(matching().filter(row => row.nonce.includes('-end-')).length, 1);
    assert.ok(matching().find(row => row.nonce.includes('-end-')).nonce.endsWith('-end-announcement'));
    events.reconcileAnnouncements({ nowMs: T0 + 122_000 });
    assert.equal(matching().length, 2);
  } finally {
    if (prior === undefined) delete process.env.HERBYBOT_AUTOMATION_TOKEN;
    else process.env.HERBYBOT_AUTOMATION_TOKEN = prior;
  }
});

test('group expiry and authoritative disconnect protect all selected species', () => {
  reset();
  create({
    durationMinutes: 5,
    speciesBonuses: [
      { species: 'omniraptor', coinsPerMinute: 100 },
      { species: 'pteranodon', coinsPerMinute: 200 },
    ],
  });
  const players = [{ steamId: player, species: 'Pteranodon' }];
  events.processSnapshot(players, { nowMs: T0 });
  assert.equal(events.processSnapshot(players, { nowMs: T0 + 60_000 }).coins, 200);
  events.processSnapshot([], { nowMs: T0 + 80_000 });
  assert.equal(events.processSnapshot(players, { nowMs: T0 + 100_000 }).coins, 0);
  assert.equal(events.processSnapshot(players, { nowMs: T0 + 160_000 }).coins, 200);
  assert.equal(events.processSnapshot(players, { nowMs: T0 + 600_000 }).coins, 0);
  assert.equal(wallet.getWallet(player).balance, 400);
});
