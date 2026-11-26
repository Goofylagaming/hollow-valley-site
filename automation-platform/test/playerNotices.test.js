'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-player-notices-'));
process.env.AUTOMATION_DB_PATH = path.join(dir, 'automation.sqlite');
process.env.PLAYER_MILESTONES_ENABLED = 'true';
process.env.PLAYER_MILESTONES_INGAME_ENABLED = 'false';
process.env.PLAYER_MILESTONES_EVENTAI_NOTIFY = 'true';
process.env.PRIME_CHAT_NOTIFY_ENABLED = 'true';
process.env.PRIME_TRACKER_ENABLED = 'true';

const { createMilestoneStore } = require('../src/services/playerMilestoneStore');
const {
  createPlayerNoticeService,
  formatPrimeReply,
  sanitizeNoticeText,
  UNAVAILABLE,
} = require('../src/services/playerNoticeService');

const alice = '76561198000000101';
const bob = '76561198000000102';
const dependencies = {
  membership: location => location == null ? { point: null } : ({
    point: {},
    sanctuaries: location.s || [],
    patrolZones: location.p || [],
    migrations: location.m || [],
  }),
  normalizeSpecies: value => String(value || '').toLowerCase(),
  growthFraction: value => value > 1 ? value / 100 : value,
};

function harness(options = {}) {
  const notices = createPlayerNoticeService({
    zoneNotifyEnabled: true,
    primeChatNotifyEnabled: true,
    ...options,
  });
  const db = new DatabaseSync(':memory:');
  const store = createMilestoneStore(db, {
    ...dependencies,
    onZoneChange: detail => notices.onZoneChange(detail),
  });
  let at = 1_700_000_000_000;
  const player = { steamId: alice, species: 'Rex', health: 100, growth: 1, location: {} };
  function snapshot(patch = {}, seconds = 5) {
    at += seconds * 1000;
    const next = { ...player, ...patch };
    notices.beginSnapshot([next.steamId]);
    store.record(next, at);
    Object.assign(player, next);
    return at;
  }
  function events() {
    return db.prepare('SELECT category, message FROM player_milestone_events ORDER BY id').all();
  }
  return { notices, store, snapshot, events, db, at: () => at };
}

test.after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

test('confirmed zone transitions become EventAI notices', () => {
  const h = harness();
  h.snapshot();
  h.snapshot({ location: { m: ['South Rail'], p: ['North Patrol'] } });
  h.snapshot({ location: { m: ['South Rail'], p: ['North Patrol'] } });
  const body = h.notices.collect({});
  const texts = body.notices.map(notice => notice.text).sort();
  assert.deepEqual(texts, [
    'Entered migration zone: South Rail',
    'Entered patrol zone: North Patrol',
  ]);
  assert.equal(body.notices.every(notice => notice.steam === alice), true);
  assert.equal(body.notices.every(notice => /^[0-9a-f-]{36}$/.test(notice.id)), true);
});

test('sanctuary leave is its own notice and website copy is unchanged', () => {
  const h = harness();
  h.snapshot();
  h.snapshot({ location: { s: ['Nest'] } });
  h.snapshot({ location: { s: ['Nest'] } });
  assert.deepEqual(h.notices.collect({}).notices.map(notice => notice.text), ['Entered sanctuary: Nest']);
  assert.ok(h.events().some(event => event.message.includes('Sanctuary entered: Nest')));
  h.snapshot({ location: { s: ['Nest'] } }, 70);
  h.snapshot({ location: {} }, 4);
  h.snapshot({ location: {} }, 4);
  assert.deepEqual(h.notices.collect({}).notices.map(notice => notice.text), ['Left sanctuary: Nest']);
  assert.ok(h.events().some(event => event.message.includes('Sanctuary left: Nest')));
});

test('sanctuary enter and leave do not share a cooldown', () => {
  const h = harness();
  h.snapshot();
  h.snapshot({ location: { s: ['Nest'] } });
  h.snapshot({ location: { s: ['Nest'] } });
  h.snapshot({ location: {} }, 4);
  h.snapshot({ location: {} }, 4);
  assert.deepEqual(h.notices.collect({}).notices.map(notice => notice.text), [
    'Entered sanctuary: Nest',
    'Left sanctuary: Nest',
  ]);
});

test('zone notices wait 60 seconds per category', () => {
  const h = harness();
  h.snapshot();
  h.snapshot({ location: { m: ['South Rail'] } });
  h.snapshot({ location: { m: ['South Rail'] } });
  assert.equal(h.notices.collect({}).notices.length, 1);

  h.snapshot({ location: {} });
  h.snapshot({ location: {} });
  h.snapshot({ location: { m: ['South Rail'] } }, 4);
  h.snapshot({ location: { m: ['South Rail'] } }, 4);
  assert.equal(h.notices.collect({}).notices.length, 0);
  assert.equal(h.store.read(alice).entries.migration, 2);

  h.snapshot({ location: {} }, 70);
  h.snapshot({ location: {} }, 4);
  h.snapshot({ location: { m: ['East'] } }, 4);
  h.snapshot({ location: { m: ['East'] } }, 4);
  const again = h.notices.collect({});
  assert.deepEqual(again.notices.map(notice => notice.text), ['Entered migration zone: East']);
});

test('the first snapshot after start or connect does not announce the current zone', () => {
  const h = harness();
  let at = 1_700_000_000_000;
  const base = { steamId: alice, species: 'Rex', health: 100, growth: 1 };
  h.store.record({ ...base, location: {} }, at);
  at += 5000;
  h.store.record({ ...base, location: { m: ['South Rail'] } }, at);
  at += 5000;
  h.notices.beginSnapshot([alice]);
  h.store.record({ ...base, location: { m: ['South Rail'] } }, at);
  assert.equal(h.notices.collect({}).notices.length, 0);

  at += 5000;
  h.notices.beginSnapshot([alice]);
  h.store.record({ ...base, location: { s: ['Nest'] } }, at);
  at += 5000;
  h.notices.beginSnapshot([alice]);
  h.store.record({ ...base, location: { s: ['Nest'] } }, at);
  assert.deepEqual(h.notices.collect({}).notices.map(notice => notice.text), ['Entered sanctuary: Nest']);

  const joined = harness();
  joined.snapshot();
  let bobAt = 1_700_000_100_000;
  const bobBase = { steamId: bob, species: 'Rex', health: 100, growth: 1 };
  joined.store.record({ ...bobBase, location: {} }, bobAt);
  bobAt += 5000;
  joined.store.record({ ...bobBase, location: { p: ['Patrol A'] } }, bobAt);
  bobAt += 5000;
  joined.notices.beginSnapshot([alice, bob]);
  joined.store.record({ ...bobBase, location: { p: ['Patrol A'] } }, bobAt);
  assert.equal(joined.notices.collect({}).notices.length, 0);

  bobAt += 5000;
  joined.notices.beginSnapshot([alice, bob]);
  joined.store.record({ ...bobBase, location: { m: ['East'] } }, bobAt);
  bobAt += 5000;
  joined.notices.beginSnapshot([alice, bob]);
  joined.store.record({ ...bobBase, location: { m: ['East'] } }, bobAt);
  assert.deepEqual(joined.notices.collect({}).notices.map(notice => notice.text), ['Entered migration zone: East']);
});

test('zone names are sanitised and notices are claimed once', () => {
  const h = harness();
  const dirty = 'South "Rail"\\\n\u0001';
  h.snapshot();
  h.snapshot({ location: { m: [dirty] } });
  h.snapshot({ location: { m: [dirty] } });
  const first = h.notices.collect({});
  assert.equal(first.notices.length, 1);
  assert.equal(first.notices[0].text, 'Entered migration zone: South Rail');
  assert.equal(first.notices[0].text.includes('"'), false);
  assert.equal(first.notices[0].text.includes('\\'), false);
  assert.equal(h.notices.collect({}).notices.length, 0);

  const longName = 'Z'.repeat(300);
  h.snapshot({ location: {} }, 70);
  h.snapshot({ location: {} }, 4);
  h.snapshot({ location: { m: [longName] } }, 4);
  h.snapshot({ location: { m: [longName] } }, 4);
  const longNotice = h.notices.collect({}).notices[0];
  assert.equal(longNotice.text.length, 200);
  assert.equal(longNotice.text.startsWith('Entered migration zone: Z'), true);
  assert.equal(/["\\\u0000-\u001F\u007F]/.test(longNotice.text), false);
});

test('uncollected notices expire after 60 seconds', () => {
  const h = harness();
  let now = 1_700_000_000_000;
  h.notices.setClock(() => now);
  h.snapshot();
  h.snapshot({ location: { p: ['Patrol A'] } });
  h.snapshot({ location: { p: ['Patrol A'] } });
  now += 61_000;
  assert.equal(h.notices.collect({}).notices.length, 0);
});

test('website alert toggles do not block EventAI notices', () => {
  const h = harness();
  h.store.setPreferences(alice, { patrol: false, migration: false, sanctuary: false });
  h.snapshot();
  h.snapshot({ location: { p: ['Patrol A'] } });
  h.snapshot({ location: { p: ['Patrol A'] } });
  assert.equal(h.events().length, 0);
  assert.deepEqual(h.notices.collect({}).notices.map(notice => notice.text), ['Entered patrol zone: Patrol A']);
});

test('the zone flag blocks new notices and drops any still queued', () => {
  let enabled = true;
  const h = harness({ zoneNotifyEnabled: () => enabled });
  h.snapshot();
  h.snapshot({ location: { m: ['South Rail'] } });
  h.snapshot({ location: { m: ['South Rail'] } });
  enabled = false;
  assert.equal(h.notices.collect({}).notices.length, 0);
  h.snapshot({ location: {} }, 70);
  h.snapshot({ location: {} }, 4);
  h.snapshot({ location: { m: ['East'] } }, 4);
  h.snapshot({ location: { m: ['East'] } }, 4);
  assert.equal(h.notices.collect({}).notices.length, 0);
});

test('a notice batch is capped and prime replies are handed out first', () => {
  const names = Array.from({ length: 25 }, (_, index) => `Zone ${index}`);
  const tracker = {
    trackerState() {
      return {
        enabled: true,
        activeLife: { species: 'Tyrannosaurus', growth: 0.5, isPrime: false, primeSeconds: 0 },
        progress: { isPrime: false, primeSeconds: 0, migrationZonesVisited: 0, patrolZonesVisited: 0, sanctuariesVisited: 0 },
        currentZones: { migrations: [], patrolZones: [], sanctuaries: [] },
      };
    },
  };
  const mixed = createPlayerNoticeService({
    zoneNotifyEnabled: true,
    primeChatNotifyEnabled: true,
    primeTracker: tracker,
  });
  mixed.beginSnapshot([]);
  mixed.beginSnapshot([alice]);
  mixed.beginSnapshot([alice]);
  mixed.onZoneChange({ steamId: alice, kind: 'migration', entered: names, left: [], at: 5_000 });
  const body = mixed.collect({
    primeRequests: [{ id: 'chat-prime-1', steam: alice, ts: 10 }],
  });
  assert.equal(body.notices.length, 20);
  assert.equal(body.notices[0].text.includes('Not Prime'), true);
  const rest = mixed.collect({});
  assert.equal(rest.notices.length, 6);
  assert.equal(rest.notices.every(notice => notice.text.startsWith('Entered migration zone:')), true);
});

test('prime replies cover enabled, disabled, missing and failed tracker reads', () => {
  assert.equal(formatPrimeReply({
    enabled: true,
    activeLife: { species: 'BP_Tyrannosaurus_C', growth: 0.87, isPrime: true, primeSeconds: 8040 },
    progress: {
      isPrime: true,
      primeSeconds: 8040,
      migrationZonesVisited: 2,
      patrolZonesVisited: 1,
      sanctuariesVisited: 1,
    },
    currentZones: { migrations: ['South Rail'], patrolZones: [], sanctuaries: [] },
  }), 'Rex 87% · PRIME 2h 14m · Migration 2 · Patrol 1 · Sanctuary 1 · now: South Rail');

  assert.equal(formatPrimeReply({
    enabled: true,
    activeLife: { species: 'Triceratops', growth: 0.4, isPrime: false, primeSeconds: 0 },
    progress: { isPrime: false, primeSeconds: 0, migrationZonesVisited: 0, patrolZonesVisited: 0, sanctuariesVisited: 0 },
    currentZones: { migrations: [], patrolZones: [], sanctuaries: [] },
  }), 'Trike 40% · Not Prime · Migration 0 · Patrol 0 · Sanctuary 0 · now: none');

  assert.equal(formatPrimeReply({ enabled: false, activeLife: { species: 'Rex' }, progress: {} }), UNAVAILABLE);
  assert.equal(formatPrimeReply({ enabled: true, activeLife: null, progress: null }), UNAVAILABLE);
  assert.equal(sanitizeNoticeText(formatPrimeReply({
    enabled: true,
    activeLife: { species: 'Rex', growth: 1, isPrime: false },
    progress: { isPrime: false, migrationZonesVisited: 0, patrolZonesVisited: 0, sanctuariesVisited: 0 },
    currentZones: { migrations: ['Bad "Name"\\\n'], patrolZones: [], sanctuaries: [] },
  })).includes('"'), false);

  const replies = { [alice]: null };
  const notices = createPlayerNoticeService({
    zoneNotifyEnabled: false,
    primeChatNotifyEnabled: true,
    primeTracker: {
      trackerState(steam) {
        if (replies.throw) throw new Error('disk down');
        return replies[steam];
      },
    },
  });
  const missing = notices.collect({ primeRequests: [{ id: 'chat-prime-missing', steam: alice, ts: 1 }] });
  assert.deepEqual(missing.notices.map(notice => notice.text), [UNAVAILABLE]);

  replies[alice] = { enabled: false, activeLife: null, progress: null };
  const disabled = notices.collect({ primeRequests: [{ id: 'chat-prime-disabled', steam: alice, ts: 2 }] });
  assert.deepEqual(disabled.notices.map(notice => notice.text), [UNAVAILABLE]);

  replies.throw = true;
  const failed = notices.collect({ primeRequests: [{ id: 'chat-prime-failed', steam: alice, ts: 3 }] });
  assert.deepEqual(failed.notices.map(notice => notice.text), [UNAVAILABLE]);

  const duplicate = notices.collect({
    primeRequests: [
      { id: 'chat-prime-failed', steam: alice, ts: 3 },
      { id: 'chat-prime-failed', steam: alice, ts: 3 },
      { id: 'bad', steam: '123', ts: 4 },
    ],
  });
  assert.equal(duplicate.notices.length, 0);
  assert.throws(() => notices.collect({ primeRequests: { id: 'nope' } }), /primeRequests must be an array/);
});

test('a prime backlog over 100 still releases zone notices and keeps the remainder', () => {
  const notices = createPlayerNoticeService({
    zoneNotifyEnabled: true,
    primeChatNotifyEnabled: true,
    primeTracker: { trackerState() { return { enabled: false }; } },
  });
  notices.beginSnapshot([]);
  notices.beginSnapshot([alice]);
  notices.beginSnapshot([alice]);
  notices.onZoneChange({ steamId: alice, kind: 'migration', entered: ['South Rail'], left: [], at: 5000 });
  const requests = Array.from({ length: 101 }, (_, index) => ({
    id: `chat-prime-backlog-${index}`,
    steam: alice,
    ts: index,
  }));
  let seenZone = false;
  let body = notices.collect({ primeRequests: requests });
  for (let attempt = 0; attempt < 8 && !seenZone; attempt += 1) {
    seenZone = body.notices.some(notice => notice.text === 'Entered migration zone: South Rail');
    if (!seenZone) body = notices.collect({});
  }
  assert.equal(seenZone, true);
  const remainder = notices.collect({ primeRequests: [requests[100]] });
  assert.equal(remainder.notices.some(notice => notice.text === UNAVAILABLE), true);
});

test('prime chat can be switched off without affecting zone notices', () => {
  let primeOn = true;
  const h = harness({
    primeChatNotifyEnabled: () => primeOn,
    primeTracker: { trackerState() { throw new Error('should not be called'); } },
  });
  h.snapshot();
  h.snapshot({ location: { p: ['Patrol A'] } });
  h.snapshot({ location: { p: ['Patrol A'] } });
  primeOn = false;
  const body = h.notices.collect({
    primeRequests: [{ id: 'chat-prime-off', steam: alice, ts: 1 }],
  });
  assert.deepEqual(body.notices.map(notice => notice.text), ['Entered patrol zone: Patrol A']);
});

test('the live milestone service feeds notices from Vulnona shapes', () => {
  const prime = require('../src/services/primeTrackerService');
  const zone = prime.loadZoneLayers().migrations
    .find(item => item.shape === 'ellipse' && Number.isFinite(item.left) && Number.isFinite(item.top));
  assert.ok(zone, 'Gateway migration zones are available');
  const inside = {
    x: -505000 + zone.left * 1112000,
    y: -607000 + zone.top * 1116000,
    z: 0,
  };
  const outside = { x: 1000000000, y: 1000000000, z: 0 };
  assert.ok(prime.zoneMembership(inside).migrations.includes(zone.name));
  assert.equal(prime.zoneMembership(outside).migrations.length, 0);
  prime._test.db.close();

  const milestones = require('../src/services/playerMilestoneService');
  const notices = require('../src/services/playerNoticeService');
  notices.reset();
  let at = Date.now() - 180000;
  const sample = location => {
    at += 5000;
    milestones.recordSnapshot([{
      steamId: alice,
      species: 'Tyrannosaurus',
      growth: 0.87,
      health: 100,
      location,
    }], new Date(at).toISOString());
  };
  sample(outside);
  sample(inside);
  sample(inside);
  const expected = sanitizeNoticeText(`Entered migration zone: ${zone.name}`);
  const body = notices.collect({});
  assert.ok(body.notices.some(notice => notice.steam === alice && notice.text === expected));
  assert.equal(notices.collect({}).notices.filter(notice => notice.text === expected).length, 0);
});
