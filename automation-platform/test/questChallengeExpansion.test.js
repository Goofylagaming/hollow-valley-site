const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-challenge-expansion-'));
  const previous = {
    db: process.env.AUTOMATION_DB_PATH,
    combatEnabled: process.env.COMBAT_FEED_ENABLED,
    combatToken: process.env.COMBAT_FEED_TOKEN,
  };
  process.env.AUTOMATION_DB_PATH = path.join(dir, 'automation.sqlite');
  process.env.COMBAT_FEED_ENABLED = 'true';
  process.env.COMBAT_FEED_TOKEN = 'test-token';

  const modules = [
    '../src/services/combatEventService',
    '../src/services/questBoostService',
    '../src/services/economyStore',
  ];
  for (const item of modules) {
    try { delete require.cache[require.resolve(item)]; } catch {}
  }

  const store = require('../src/services/economyStore');
  const quests = require('../src/services/questBoostService');
  const combat = require('../src/services/combatEventService');

  return {
    store,
    quests,
    combat,
    cleanup() {
      for (const item of modules) {
        try { delete require.cache[require.resolve(item)]; } catch {}
      }
      if (previous.db === undefined) delete process.env.AUTOMATION_DB_PATH;
      else process.env.AUTOMATION_DB_PATH = previous.db;
      if (previous.combatEnabled === undefined) delete process.env.COMBAT_FEED_ENABLED;
      else process.env.COMBAT_FEED_ENABLED = previous.combatEnabled;
      if (previous.combatToken === undefined) delete process.env.COMBAT_FEED_TOKEN;
      else process.env.COMBAT_FEED_TOKEN = previous.combatToken;
    },
  };
}

test('species challenges pay VC after 90 verified minutes and do not duplicate', (t) => {
  const fixture = loadFixture();
  t.after(fixture.cleanup);
  const steamId = '76561198000001001';
  const now = Date.parse('2026-09-27T02:00:00.000Z');
  fixture.quests.updateQuestProgress(steamId, { elapsedSeconds: 45 * 60, continuous: true, nowMs: now, player: { steamId, species: 'Triceratops', growth: 0.4 } });
  let status = fixture.quests.getQuestStatus(steamId, { nowMs: now });
  let herb = status.challenges.find((item) => item.id === 'herbivore-time');
  assert.equal(herb.completed, false);
  assert.equal(herb.progressSeconds, 45 * 60);
  fixture.quests.updateQuestProgress(steamId, { elapsedSeconds: 45 * 60, continuous: true, nowMs: now + 45 * 60_000, player: { steamId, species: 'Triceratops', growth: 0.49 } });
  status = fixture.quests.getQuestStatus(steamId, { nowMs: now + 45 * 60_000 });
  herb = status.challenges.find((item) => item.id === 'herbivore-time');
  assert.equal(herb.completed, true);
  assert.equal(herb.rewardCoins, 2500);
  assert.equal(fixture.store.getWallet(steamId).balance, 2500);
  fixture.quests.updateQuestProgress(steamId, { elapsedSeconds: 60, continuous: true, nowMs: now + 46 * 60_000, player: { steamId, species: 'Triceratops', growth: 0.49 } });
  assert.equal(fixture.store.getWallet(steamId).balance, 2500);
});

test('small carnivore challenge uses the approved small-species roster', (t) => {
  const fixture = loadFixture();
  t.after(fixture.cleanup);
  const steamId = '76561198000001002';
  const now = Date.parse('2026-09-27T03:00:00.000Z');
  fixture.quests.updateQuestProgress(steamId, { elapsedSeconds: 90 * 60, continuous: true, nowMs: now, player: { steamId, species: 'Troodon', growth: 0.6 } });
  const status = fixture.quests.getQuestStatus(steamId, { nowMs: now });
  const tiny = status.challenges.find((item) => item.id === 'small-carnivore');
  assert.equal(tiny.completed, true);
  assert.equal(fixture.store.getWallet(steamId).balance, 2500);
});

test('combat challenges count authoritative kills once and pay idempotently', (t) => {
  const fixture = loadFixture();
  t.after(fixture.cleanup);
  const killerSteamId = '76561198000001003';
  const victimA = '76561198000001004';
  const victimB = '76561198000001005';
  const occurredAt = '2026-09-27T04:00:00.000Z';
  fixture.combat.ingestEvent({ eventId: 'questkill001', occurredAt, killerSteamId, killerName: 'Hunter', victimSteamId: victimA, victimName: 'Victim A' });
  fixture.combat.ingestEvent({ eventId: 'questkill002', occurredAt: '2026-09-27T04:01:00.000Z', killerSteamId, killerName: 'Hunter', victimSteamId: victimB, victimName: 'Victim B' });
  const status = fixture.quests.getQuestStatus(killerSteamId, { nowMs: Date.parse(occurredAt) });
  const daily = status.challenges.find((item) => item.id === 'combat-two-kills');
  assert.equal(daily.completed, true);
  assert.equal(daily.progressCount, 2);
  assert.equal(fixture.store.getWallet(killerSteamId).balance, 2500);
  const duplicate = fixture.combat.ingestEvent({ eventId: 'questkill002', occurredAt: '2026-09-27T04:01:00.000Z', killerSteamId, killerName: 'Hunter', victimSteamId: victimB, victimName: 'Victim B' });
  assert.equal(duplicate.duplicate, true);
  assert.equal(fixture.store.getWallet(killerSteamId).balance, 2500);
});
