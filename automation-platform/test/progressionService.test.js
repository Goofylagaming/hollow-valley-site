const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadProgression() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-progression-'));
  const previous = {
    db: process.env.AUTOMATION_DB_PATH,
    gap: process.env.PROGRESSION_MAX_SAMPLE_GAP_SECONDS,
  };
  process.env.AUTOMATION_DB_PATH = path.join(dir, 'progression.sqlite');
  process.env.PROGRESSION_MAX_SAMPLE_GAP_SECONDS = '90';

  const storePath = require.resolve('../src/services/economyStore');
  const progressionPath = require.resolve('../src/services/progressionService');
  delete require.cache[progressionPath];
  delete require.cache[storePath];
  const store = require(storePath);
  const progression = require(progressionPath);

  return {
    store,
    progression,
    cleanup() {
      try { store.db.close?.(); } catch {}
      delete require.cache[progressionPath];
      delete require.cache[storePath];
      if (previous.db === undefined) delete process.env.AUTOMATION_DB_PATH;
      else process.env.AUTOMATION_DB_PATH = previous.db;
      if (previous.gap === undefined) delete process.env.PROGRESSION_MAX_SAMPLE_GAP_SECONDS;
      else process.env.PROGRESSION_MAX_SAMPLE_GAP_SECONDS = previous.gap;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('collector badge counts distinct personal entitlements and persists without rewards', (t) => {
  const fixture = loadProgression();
  t.after(fixture.cleanup);
  const { store, progression } = fixture;
  const a = '76561198000000901', b = '76561198000000902';
  store.ensureWallet(a); store.ensureWallet(b);
  const insert = store.db.prepare(`INSERT INTO economy_skin_presets
    (id,owner_steam_id,species,name,skin_json,active,is_premium) VALUES (?,?,'Rex',?,'{}',?,?)`);
  for (let i = 0; i < 12; i++) insert.run('catalog'+i,b,'Catalog '+i,1,1);
  for (let i = 0; i < 9; i++) insert.run('owned'+i,a,'Owned '+i,1,0);
  insert.run('inactive',a,'Inactive',0,0);
  // Two entitlement paths to one skin still count once.
  store.db.prepare('INSERT INTO economy_skin_unlocks (steam_id,preset_id) VALUES (?,?)').run(a,'owned0');
  store.db.prepare('INSERT INTO economy_skin_grants (steam_id,preset_id,revoked_at) VALUES (?,?,?)').run(a,'catalog0','2026-11-01');
  const badge = () => progression.getProfile(a).achievements.find(x => x.id === 'skins-10');
  assert.equal(badge(), undefined, 'shared premium catalog, inactive skins and revoked grants do not count');
  store.db.prepare('INSERT INTO economy_skin_grants (steam_id,preset_id) VALUES (?,?)').run(a,'catalog1');
  const earned = badge();
  assert.equal(earned.title, 'Valley Collector');
  assert.equal(earned.metadata.value, 10);
  store.db.prepare("UPDATE economy_skin_grants SET revoked_at='2026-11-05' WHERE steam_id=?").run(a);
  assert.deepEqual(badge(), earned, 'earned achievement remains permanent');
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM progression_achievements WHERE steam_id=? AND achievement_id='skins-10'").get(a).n,1);
  assert.equal(store.getWallet(a).balance,0);
  assert.equal(progression.getProfile(a).xp,0);
  const c = '76561198000000903';
  store.ensureWallet(c);
  assert.equal(progression.getProfile(c).achievements.some(x => x.id === 'skins-10'),false);
  for (let i=0;i<10;i++) store.db.prepare('INSERT INTO economy_skin_unlocks (steam_id,preset_id) VALUES (?,?)').run(c,'catalog'+i);
  assert.equal(progression.getProfile(c).achievements.find(x => x.id === 'skins-10').metadata.value,10);
  assert.equal(store.getWallet(c).balance,0);
});

test('permanent XP levels award exactly 100 VC once per level', (t) => {
  const fixture = loadProgression();
  t.after(fixture.cleanup);
  const { store, progression } = fixture;
  const steamId = '76561198000000101';

  let result = progression.awardXp({
    steamId,
    amount: 250,
    source: 'test',
    reason: 'Reach level two',
    idempotencyKey: 'progression-test:level-2',
  });
  assert.equal(result.newLevel, 2);
  assert.equal(result.vcAwarded, 100);
  assert.equal(store.getWallet(steamId).balance, 100);

  result = progression.awardXp({
    steamId,
    amount: 250,
    source: 'test',
    reason: 'Reach level two',
    idempotencyKey: 'progression-test:level-2',
  });
  assert.equal(result.duplicate, true);
  assert.equal(store.getWallet(steamId).balance, 100);

  result = progression.awardXp({
    steamId,
    amount: 300,
    source: 'test',
    reason: 'Reach level three',
    idempotencyKey: 'progression-test:level-3',
  });
  assert.equal(result.newLevel, 3);
  assert.equal(store.getWallet(steamId).balance, 200);
  assert.equal(
    store.getWallet(steamId).transactions.filter((tx) => tx.kind === 'progression_level_reward').length,
    2
  );
});

test('verified playtime earns permanent XP even without Valley Coin playtime rewards', (t) => {
  const fixture = loadProgression();
  t.after(fixture.cleanup);
  const { progression } = fixture;
  const steamId = '76561198000000102';
  const player = [{ steamId }];
  const start = Date.parse('2026-09-25T00:00:00.000Z');

  for (let minute = 0; minute <= 5; minute += 1) {
    progression.trackOnlinePlayers(player, { nowMs: start + minute * 60_000 });
  }

  const profile = progression.getProfile(steamId);
  assert.equal(profile.xp, 10);
  assert.equal(profile.verifiedPlaytimeMinutes, 5);
  assert.equal(profile.level, 1);
  assert.equal(profile.xpPer5Minutes, 10);
});

test('quest and event completions sync idempotently into permanent progression', (t) => {
  const fixture = loadProgression();
  t.after(fixture.cleanup);
  const { store, progression } = fixture;
  const steamId = '76561198000000103';
  store.ensureWallet(steamId);

  store.db.prepare(`
    INSERT INTO economy_quest_achievements (steam_id, quest_id, period_key, boost_percent)
    VALUES (?, 'daily-consecutive-1h', '2026-09-25', 5)
  `).run(steamId);

  let sync = progression.syncQuestXp(steamId);
  assert.equal(sync.awarded, 250);
  sync = progression.syncQuestXp(steamId);
  assert.equal(sync.awarded, 0);

  store.db.exec(`
    CREATE TABLE IF NOT EXISTS event_attendance (
      event_id TEXT NOT NULL,
      steam_id TEXT NOT NULL,
      event_title TEXT NOT NULL,
      status TEXT NOT NULL,
      confirmed_at TEXT,
      PRIMARY KEY (event_id, steam_id)
    );
  `);
  store.db.prepare(`
    INSERT INTO event_attendance (event_id, steam_id, event_title, status, confirmed_at)
    VALUES ('event:test:1', ?, 'Test Event', 'paid', datetime('now'))
  `).run(steamId);

  sync = progression.syncEventXp(steamId);
  assert.equal(sync.awarded, 1000);
  sync = progression.syncEventXp(steamId);
  assert.equal(sync.awarded, 0);

  const profile = progression.getProfile(steamId);
  assert.equal(profile.xp, 1250);
  assert.equal(profile.level, 4);
  assert.equal(profile.questsCompleted, 1);
  assert.equal(profile.eventsAttended, 1);
  assert.ok(profile.achievements.some((item) => item.id === 'quest-1'));
  assert.ok(profile.achievements.some((item) => item.id === 'event-1'));
  assert.equal(store.getWallet(steamId).balance, 300);
});

test('Discord identity links to the same Steam-keyed progression profile', (t) => {
  const fixture = loadProgression();
  t.after(fixture.cleanup);
  const { progression } = fixture;
  const steamId = '76561198000000104';
  const discordId = '123456789012345678';

  progression.awardXp({
    steamId,
    amount: 250,
    source: 'test',
    reason: 'Discord profile fixture',
    idempotencyKey: 'progression-test:discord-profile',
  });
  progression.linkDiscordIdentity({ steamId, discordId });

  const profile = progression.getProfileByDiscord(discordId);
  assert.equal(profile.steamId, steamId);
  assert.equal(profile.level, 2);
  assert.equal(progression.steamIdForDiscord(discordId), steamId);
});
