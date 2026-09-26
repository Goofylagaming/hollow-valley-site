const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function skin() {
  const color = { r: 0.2, g: 0.3, b: 0.4, a: 1 };
  return {
    body: color,
    markings: color,
    flank: color,
    underbelly: color,
    teeth: color,
    mouth: color,
    claws: color,
    detail1: color,
    eyes: color,
    maleDisplay: color,
    skinVariation: 0,
    patternIndex: 0,
    themeIndex: 0,
  };
}

function loadFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-skin-share-policy-'));
  const previousDb = process.env.AUTOMATION_DB_PATH;
  const previousEnabled = process.env.SKIN_SYSTEM_ENABLED;
  process.env.AUTOMATION_DB_PATH = path.join(dir, 'economy.sqlite');
  process.env.SKIN_SYSTEM_ENABLED = 'true';

  const paths = [
    require.resolve('../src/services/economyStore'),
    require.resolve('../src/services/parkedDinoFileService'),
    require.resolve('../src/services/dinoStorageService'),
    require.resolve('../src/services/skinPresetService'),
    require.resolve('../src/services/skinSharePolicyService'),
  ];
  for (const modulePath of paths) delete require.cache[modulePath];

  const store = require('../src/services/economyStore');
  const skins = require('../src/services/skinPresetService');
  const policy = require('../src/services/skinSharePolicyService');

  return {
    store,
    skins,
    policy,
    cleanup() {
      try { store.db.close?.(); } catch {}
      for (const modulePath of paths) delete require.cache[modulePath];
      if (previousDb === undefined) delete process.env.AUTOMATION_DB_PATH;
      else process.env.AUTOMATION_DB_PATH = previousDb;
      if (previousEnabled === undefined) delete process.env.SKIN_SYSTEM_ENABLED;
      else process.env.SKIN_SYSTEM_ENABLED = previousEnabled;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('reconcile removes existing HV codes from non-admin owners and preserves admins', async (t) => {
  const fixture = loadFixture();
  t.after(fixture.cleanup);
  const adminSteamId = '76561198000000801';
  const playerSteamId = '76561198000000802';

  const admin = await fixture.skins.createPresetFromStudio({
    steamId: adminSteamId,
    species: 'Tyrannosaurus',
    name: 'Admin Skin',
    skin: skin(),
    idempotencyKey: 'share-policy:admin-before',
  });
  const player = await fixture.skins.createPresetFromStudio({
    steamId: playerSteamId,
    species: 'Triceratops',
    name: 'Player Skin',
    skin: skin(),
    idempotencyKey: 'share-policy:player-before',
  });

  assert.match(admin.preset.share_code, /^HV-/);
  assert.match(player.preset.share_code, /^HV-/);

  const result = fixture.policy.reconcileAdminShareCodes([adminSteamId]);
  assert.equal(result.adminCount, 1);
  assert.equal(result.removedShareCodes, 1);
  assert.match(fixture.store.getSkinPreset(admin.preset.id).share_code, /^HV-/);
  assert.equal(fixture.store.getSkinPreset(player.preset.id).share_code, null);
  assert.equal(fixture.policy.getPolicyState().remainingNonAdminShareCodes, 0);
});

test('after sync, database trigger blocks new HV codes for non-admin owners', async (t) => {
  const fixture = loadFixture();
  t.after(fixture.cleanup);
  const adminSteamId = '76561198000000803';
  const playerSteamId = '76561198000000804';

  fixture.policy.reconcileAdminShareCodes([adminSteamId]);

  const player = await fixture.skins.createPresetFromStudio({
    steamId: playerSteamId,
    species: 'Deinosuchus',
    name: 'No Share Code',
    skin: skin(),
    idempotencyKey: 'share-policy:player-after',
  });
  const admin = await fixture.skins.createPresetFromStudio({
    steamId: adminSteamId,
    species: 'Tyrannosaurus',
    name: 'Admin Share Code',
    skin: skin(),
    idempotencyKey: 'share-policy:admin-after',
  });

  assert.equal(player.preset.share_code, null);
  assert.match(admin.preset.share_code, /^HV-[A-F0-9]{5}-[A-F0-9]{5}$/);
});
