const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('Skin Studio stores verified live assignments and apply job state', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-skin-live-'));
  process.env.AUTOMATION_DB_PATH = path.join(dir, 'automation.sqlite');

  const storePath = require.resolve('../src/services/economyStore');
  delete require.cache[storePath];
  const store = require(storePath);

  t.after(() => {
    try { store.db.close(); } catch {}
    delete require.cache[storePath];
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const steamId = '76561198000000401';
  const presetId = 'preset-persistence-test';
  const skin = {
    body: { r: 0.1, g: 0.2, b: 0.3, a: 1 },
    markings: { r: 0.2, g: 0.3, b: 0.4, a: 1 },
  };
  const lifeMarker = { species: 'Tyrannosaurus', growth: 0.12, gender: 'Male' };

  store.ensureWallet(steamId);
  store.db.prepare(
    'INSERT INTO economy_skin_presets (id, owner_steam_id, species, name, description, skin_json) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(presetId, steamId, 'Tyrannosaurus', 'Persistence Test', '', JSON.stringify(skin));

  const job = store.createSkinApplyJob({
    id: 'skin-job-persistence-001',
    steamId,
    presetId,
    species: 'Tyrannosaurus',
    skin,
    lifeMarker,
  });
  assert.equal(job.status, 'queued');
  assert.equal(job.attempts, 1);
  assert.equal(job.lifeMarker.growth, 0.12);

  const assignment = store.upsertSkinLiveAssignment({
    steamId,
    presetId,
    species: 'Tyrannosaurus',
    skin,
    lifeMarker,
    requestId: job.id,
    status: 'verified',
  });
  assert.equal(assignment.status, 'verified');
  assert.equal(assignment.preset_id, presetId);
  assert.deepEqual(assignment.skin.body, skin.body);

  const completed = store.updateSkinApplyJob({
    id: job.id,
    status: 'verified',
    completed: true,
  });
  assert.equal(completed.status, 'verified');
  assert.ok(completed.completed_at);

  assert.equal(store.clearSkinLiveAssignment(steamId).cleared, true);
  assert.equal(store.getSkinLiveAssignment(steamId), null);
});
