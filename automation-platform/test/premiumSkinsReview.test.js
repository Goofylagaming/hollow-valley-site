const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AUTOMATION_DB_PATH = ':memory:';
process.env.SKIN_SYSTEM_ENABLED = 'true';
process.env.MEMBERSHIP_PREMIUM_SKINS_ENABLED = 'true';
const store = require('../src/services/economyStore');
const skins = require('../src/services/skinPresetService');
const premium = require('../src/services/premiumSkinService');
const OWNER = '76561198000000011';
const MEMBER = '76561198000000012';

function reset() {
  store.db.exec('DELETE FROM economy_membership_skin_claims; DELETE FROM economy_membership_skin_catalog; DELETE FROM economy_skin_unlocks; DELETE FROM economy_skin_grants; DELETE FROM economy_skin_presets; DELETE FROM economy_wallets;');
}

function draft() {
  return premium.seedDrafts({ ownerSteamId: OWNER }).skins[0];
}

function verification(skin) {
  return { skinId: skin.id, actorSteamId: OWNER, verifiedSpecies: ['Tyrannosaurus'],
    note: 'Verified this saved palette on a Tyrannosaurus in staging.',
    confirmedInGame: true, expectedVersion: skin.version };
}

function publish(skin) {
  premium.verifyDraft(verification(skin));
  premium.setPublished({ skinId: skin.id, actorSteamId: OWNER, published: true });
}

function interleaveBeforeNextWrite(t, action) {
  // Deterministically model a second worker committing immediately before this
  // worker acquires its write lock. Reads outside that lock are then stale.
  const original = store.db.exec.bind(store.db);
  let inserted = false;
  t.mock.method(store.db, 'exec', (sql) => {
    if (!inserted && /^BEGIN IMMEDIATE\s*;?$/i.test(sql)) {
      inserted = true;
      action();
    }
    return original(sql);
  });
  return () => inserted;
}

test('verification rejects a concurrent draft edit committed before its write lock', (t) => {
  reset();
  const skin = draft();
  const interleaved = interleaveBeforeNextWrite(t, () => premium.updateDraft({ skinId: skin.id, actorSteamId: OWNER,
    species: skin.species, name: 'Changed before verification', description: skin.description, skin: skin.skin }));
  assert.throws(() => premium.verifyDraft(verification(skin)), { code: 'PREMIUM_DRAFT_CHANGED' });
  assert.equal(interleaved(), true);
  const saved = premium.listCatalog(OWNER, { admin: true }).skins.find((item) => item.id === skin.id);
  assert.equal(saved.state, 'draft');
  assert.equal(saved.verifiedAt, null);
  assert.equal(saved.name, 'Changed before verification');
});

test('draft edit cannot mutate a palette another worker has just verified', (t) => {
  reset();
  const skin = draft();
  const interleaved = interleaveBeforeNextWrite(t, () => premium.verifyDraft(verification(skin)));
  assert.throws(() => premium.updateDraft({ skinId: skin.id, actorSteamId: OWNER, species: skin.species,
    name: 'Unreviewed replacement', description: skin.description, skin: skin.skin }), { code: 'PREMIUM_SKIN_IMMUTABLE' });
  assert.equal(interleaved(), true);
  const saved = premium.listCatalog(OWNER, { admin: true }).skins.find((item) => item.id === skin.id);
  assert.equal(saved.state, 'reviewed');
  assert.equal(saved.name, skin.name);
  assert.deepEqual(saved.verifiedSpecies, ['Tyrannosaurus']);
});

test('a new claim cannot unlock a skin archived while the claim waits for its write lock', (t) => {
  reset();
  const skin = draft();
  publish(skin);
  const interleaved = interleaveBeforeNextWrite(t, () => premium.setPublished({ skinId: skin.id, actorSteamId: OWNER, published: false }));
  assert.throws(() => premium.fulfillClaim({ claimId: 'claim_archival_race', steamId: MEMBER, skinId: skin.id }), { code: 'PREMIUM_SKIN_UNAVAILABLE' });
  assert.equal(interleaved(), true);
  assert.equal(store.hasSkinUnlock(MEMBER, skin.presetId), false);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM economy_membership_skin_claims').get().n, 0);
});

test('creator testing bypass applies only to unpublished drafts, never reviewed/published/archived palettes', () => {
  reset();
  const skin = draft();
  assert.doesNotThrow(() => skins.assertMembershipSpecies(store.getSkinPreset(skin.presetId), OWNER, 'Omniraptor'));
  premium.verifyDraft(verification(skin));
  assert.throws(() => skins.assertMembershipSpecies(store.getSkinPreset(skin.presetId), OWNER, 'Omniraptor'), { code: 'PREMIUM_SKIN_SPECIES_UNVERIFIED' });
  for (const published of [true, false]) {
    premium.setPublished({ skinId: skin.id, actorSteamId: OWNER, published });
    const preset = store.getSkinPreset(skin.presetId);
    assert.throws(() => skins.assertMembershipSpecies(preset, OWNER, 'Omniraptor'), { code: 'PREMIUM_SKIN_SPECIES_UNVERIFIED' });
    assert.doesNotThrow(() => skins.assertMembershipSpecies(preset, OWNER, 'BP_Tyrannosaurus_C'));
  }
});

test('ordinary legacy presets keep their existing public access and species handling', async () => {
  reset();
  const source = draft();
  const ordinary = await skins.createPresetFromStudio({ steamId: OWNER, species: 'Universal', name: 'Legacy public palette',
    description: 'Existing ordinary preset behaviour', skin: source.skin, idempotencyKey: 'legacy-public-review' });
  skins.publishPreset({ presetId: ordinary.preset.id, price: 0, published: true });
  const accessible = skins.getPresetForPlayer(MEMBER, ordinary.preset.id);
  assert.equal(accessible.isPremium, true);
  assert.equal(accessible.membershipPremium, false);
  assert.doesNotThrow(() => skins.assertMembershipSpecies(accessible, MEMBER, 'Omniraptor'));
  assert.equal(skins.listStore(MEMBER).some((item) => item.id === ordinary.preset.id), true);
});
