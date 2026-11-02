'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const groups = require('../src/services/nativeGroupMembershipService');

const A = '76561198000000001';
const B = '76561198000000002';
const C = '76561198000000003';
const D = '76561198000000004';
const now = Date.now();
function sample(overrides = {}, sampledAtMs = now) {
  return {
    schemaVersion: 1, source: 'evrima-native-server-v1', complete: true,
    sampleId: 'group-test-0001', presenceSampleId: 'presence-test-0001',
    sampledAt: new Date(sampledAtMs).toISOString(),
    groups: [{ id: 'native-one', members: [A, B] }, { id: 'native-two', members: [C, D] }],
    ...overrides,
  };
}
function presence(overrides = {}, sampledAtMs = now) {
  return {
    online: true, source: 'external-presence', stale: false, error: null,
    sampleId: 'presence-test-0001', checkedAt: new Date(sampledAtMs).toISOString(),
    characters: [A, B, C, D].map((steamId) => ({ steamId })),
    ...overrides,
  };
}
function enable(t) {
  const before = process.env.GROUPMATES_NATIVE_SOURCE_VERIFIED;
  process.env.GROUPMATES_NATIVE_SOURCE_VERIFIED = '1';
  groups.resetForTests();
  t.after(() => {
    groups.resetForTests();
    if (before === undefined) delete process.env.GROUPMATES_NATIVE_SOURCE_VERIFIED;
    else process.env.GROUPMATES_NATIVE_SOURCE_VERIFIED = before;
  });
}

test('disabled until independently verified native data source exists', (t) => {
  const old = process.env.GROUPMATES_NATIVE_SOURCE_VERIFIED;
  delete process.env.GROUPMATES_NATIVE_SOURCE_VERIFIED;
  groups.resetForTests();
  t.after(() => {
    if (old === undefined) delete process.env.GROUPMATES_NATIVE_SOURCE_VERIFIED;
    else process.env.GROUPMATES_NATIVE_SOURCE_VERIFIED = old;
  });
  assert.equal(groups.enabled(), false);
  assert.throws(() => groups.ingest(sample()), { code: 'GROUP_SOURCE_DISABLED', status: 404 });
  assert.equal(groups.groupmatesFor(A, presence()).verified, false);
});

test('only strictly bounded complete native rosters are accepted', (t) => {
  enable(t);
  assert.throws(() => groups.ingest(sample({ complete: false })), { code: 'GROUP_SAMPLE_INVALID' });
  assert.throws(() => groups.ingest(sample({ source: 'website-groups' })), { code: 'GROUP_SAMPLE_INVALID' });
  assert.throws(() => groups.ingest(sample({ presenceSampleId: undefined })), { code: 'GROUP_SAMPLE_INVALID' });
  assert.throws(() => groups.ingest(sample({ groups: [{ id: 'one', members: [A, A] }] })), { code: 'GROUP_SAMPLE_INVALID' });
  assert.throws(() => groups.ingest(sample({ groups: [{ id: 'one', members: [A] }, { id: 'two', members: [A] }] })), { code: 'GROUP_SAMPLE_INVALID' });
  assert.throws(() => groups.ingest(sample({ groups: [{ id: 'one', members: ['bad-steam'] }] })), { code: 'GROUP_SAMPLE_INVALID' });
  assert.throws(() => groups.ingest(sample({}, now - 31_000), { nowMs: now }), { code: 'GROUP_SAMPLE_INVALID' });
  assert.throws(() => groups.ingest(sample({}, now + 6_000), { nowMs: now }), { code: 'GROUP_SAMPLE_INVALID' });
});

test('matches only true groupmates from same verified presence tick', (t) => {
  enable(t);
  assert.deepEqual(groups.ingest(sample(), { nowMs: now }), { duplicate: false });
  const result = groups.groupmatesFor(A, presence(), { nowMs: now });
  assert.equal(result.verified, true);
  assert.deepEqual(result.memberSteamIds, [B]);
  assert.equal(JSON.stringify(result).includes('native-one'), false);
  assert.deepEqual(groups.groupmatesFor(C, presence(), { nowMs: now }).memberSteamIds, [D]);
  assert.equal(groups.groupmatesFor(A, presence({ sampleId: 'presence-test-0002' }), { nowMs: now }).verified, false);
  assert.equal(groups.groupmatesFor(A, presence({ source: 'rcon-fallback' }), { nowMs: now }).verified, false);
  assert.equal(groups.groupmatesFor(A, presence({ stale: true }), { nowMs: now }).verified, false);
  assert.equal(groups.groupmatesFor(A, presence({ online: false }), { nowMs: now }).verified, false);
  assert.equal(groups.groupmatesFor(A, presence({}, now - 46_000), { nowMs: now }).verified, false);
  assert.equal(groups.groupmatesFor(A, presence(), { nowMs: now + 31_000 }).verified, false);
});

test('new full roster revokes prior membership immediately', (t) => {
  enable(t);
  groups.ingest(sample(), { nowMs: now });
  groups.ingest(sample({
    sampleId: 'group-test-0002', presenceSampleId: 'presence-test-0002',
    groups: [{ id: 'native-one', members: [A] }, { id: 'native-two', members: [B, C] }],
  }, now + 1000), { nowMs: now + 1000 });
  const fresh = presence({ sampleId: 'presence-test-0002' }, now + 1000);
  assert.deepEqual(groups.groupmatesFor(A, fresh, { nowMs: now + 1000 }).memberSteamIds, []);
  assert.deepEqual(groups.groupmatesFor(B, fresh, { nowMs: now + 1000 }).memberSteamIds, [C]);
  assert.equal(groups.groupmatesFor(A, presence(), { nowMs: now + 1000 }).verified, false);
});

test('duplicates cannot refresh TTL; replay conflicts and ordering fail closed', (t) => {
  enable(t);
  groups.ingest(sample(), { nowMs: now });
  assert.deepEqual(groups.ingest(sample(), { nowMs: now + 1000 }), { duplicate: true });
  assert.throws(() => groups.ingest(sample({ groups: [] }), { nowMs: now + 1000 }), { code: 'GROUP_SAMPLE_CONFLICT', status: 409 });
  assert.throws(() => groups.ingest(sample({ sampleId: 'group-test-0002' }, now - 1000), { nowMs: now + 1000 }), { code: 'GROUP_SAMPLE_STALE', status: 409 });
  assert.equal(groups.groupmatesFor(A, presence(), { nowMs: now + 31_000 }).verified, false);
});
