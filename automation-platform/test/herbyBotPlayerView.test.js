const { test } = require('node:test');
const assert = require('node:assert/strict');
const { playerView } = require('../src/services/herbyBotPlayerView');
const services = {
  progression: { steamIdForDiscord: id => id === '123456789' ? 'linked' : null,
    getProfile: (id, options) => { assert.equal(id, 'linked'); assert.equal(options.sync, false);
      return { level: 3, xp: 40, questsCompleted: 2, secret: 'PRIVATE' }; } },
  economy: { getWallet: id => { assert.equal(id, 'linked'); return { balance: 50, token: 'PRIVATE' }; } },
  quests: { getQuestStatus: id => { assert.equal(id,'linked'); return {quests:[{
    title:'Daily playtime',cadence:'daily',progressSeconds:60,thresholdSeconds:300,completed:false,steamId:'PRIVATE'}]}; } },
  prime: { trackerState: () => ({ activeLife: {}, progress: { isPrime: true }, location: 'PRIVATE' }) },
  status: { getServerSnapshot: async () => ({ online: true, characters: [
    { steamId: 'other', species: 'PRIVATE' }, { steamId: 'linked', species: 'Rex', growth: 0.5, location: 'PRIVATE' }] }) },
};
test('all player views resolve linked identity and return only explicit safe fields', async () => {
  for (const view of ['player','wallet','quests','prime','dino']) {
    const result = await playerView('123456789', view, services);
    assert.ok(Object.keys(result.fields).length);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|steamId|token|location/);
  }
  assert.equal((await playerView('123456789', 'wallet', services)).fields.balance, 50);
});
test('unlinked identities, invalid IDs and arbitrary views fail closed', async () => {
  await assert.rejects(playerView('987654321', 'wallet', services), /NOT_LINKED/);
  await assert.rejects(playerView('../wallet', 'wallet', services), /INVALID_ID/);
  await assert.rejects(playerView('123456789', 'restart', services), /INVALID_VIEW/);
});
test('offline character lookup exposes no stale data', async () => {
  const result = await playerView('123456789', 'dino', {...services,
    status: { getServerSnapshot: async () => ({online:false,characters:[{steamId:'linked',species:'STALE'}]}) }});
  assert.deepEqual(result, {fields:{status:'server_offline'}});
});
