const test = require('node:test');
const assert = require('node:assert/strict');

const service = require('../src/services/serverModDeployService');

test('approved server mod deployment is whitelist-only and installs SkinStudio before CommandBridge', () => {
  assert.deepEqual(
    service.APPROVED_MODS.map((mod) => [mod.id, mod.name, mod.relativeRemote]),
    [
      ['skin-studio', 'SkinStudio', 'Mods/SkinStudio/Scripts/main.lua'],
      ['command-bridge', 'CommandBridge', 'Mods/CommandBridge/Scripts/main.lua'],
    ]
  );
  assert.ok(service.APPROVED_MODS.every((mod) => /\/Scripts\/main\.lua$/.test(mod.relativeRemote)));
  assert.ok(service.APPROVED_MODS.every((mod) => !/\/Saved\//i.test(mod.relativeRemote)));
});

test('reads versions from the approved mod headers', () => {
  assert.equal(service.parseModVersion('-- SkinStudio v002\n', 'SkinStudio'), 'v002');
  assert.equal(service.parseModVersion('-- CommandBridge v006.1\n', 'CommandBridge'), 'v006.1');
  assert.equal(service.parseModVersion('-- SomethingElse v1\n', 'SkinStudio'), null);
});

test('deployment is locked unless the explicit server-side gate is enabled', async () => {
  const previous = process.env.SERVER_MOD_DEPLOY_ENABLED;
  delete process.env.SERVER_MOD_DEPLOY_ENABLED;
  try {
    await assert.rejects(
      () => service.deployApprovedServerMods({ confirmation: service.CONFIRM_PHRASE }),
      (error) => error?.code === 'SERVER_MOD_DEPLOY_DISABLED'
    );
  } finally {
    if (previous === undefined) delete process.env.SERVER_MOD_DEPLOY_ENABLED;
    else process.env.SERVER_MOD_DEPLOY_ENABLED = previous;
  }
});

test('status remains readable when FTP is not configured', async () => {
  const keys = ['SFTP_HOST', 'SFTP_PORT', 'SFTP_USER', 'SFTP_PASSWORD', 'SFTP_BASE_PATH'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];

  try {
    const state = await service.getServerModDeployState({ inspectRemote: false });
    assert.equal(state.ftpConfigured, false);
    assert.equal(state.preservesSavedFolders, true);
    assert.equal(state.approvedOnly, true);
    assert.equal(state.mods.length, 2);
    assert.ok(state.mods.every((mod) => mod.remotePath === null));
    assert.deepEqual(state.mods.map((mod) => mod.localVersion), ['v002', 'v006.1']);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
