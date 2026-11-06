const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'hv-species-badges-'));
process.env.AUTOMATION_DB_PATH = path.join(dir,'test.sqlite');
process.env.COMBAT_FEED_ENABLED = 'true';
// Exercise an old database rather than only a newly created schema.
const legacy = new DatabaseSync(process.env.AUTOMATION_DB_PATH);
legacy.exec(`CREATE TABLE combat_events (id TEXT PRIMARY KEY,occurred_at TEXT NOT NULL,
  killer_steam_id TEXT,killer_name TEXT,victim_steam_id TEXT NOT NULL,victim_name TEXT,
  source TEXT NOT NULL,created_at TEXT DEFAULT(datetime('now')));
  INSERT INTO combat_events VALUES ('legacy-event','2026-01-01',NULL,NULL,'76561198000001002',NULL,'legacy',datetime('now'));`);
legacy.close();
const combat = require('../src/services/combatEventService');
const progression = require('../src/services/progressionService');
const store = require('../src/services/economyStore');
const { parseCombatLine } = require('../../scripts/game-combat-line');
const a = '76561198000001001', b = '76561198000001002';
let sequence = 0;
const event = (species, extra={}) => ({eventId:'species-event-'+(++sequence),
  occurredAt:new Date(Date.UTC(2026,9,1,0,sequence)).toISOString(),
  killerSteamId:a,victimSteamId:b,victimSpecies:species,...extra});
const badge = () => progression.getProfile(a).achievements.find(x=>x.id==='combat-species-5');
test.after(() => { combat._test.db.close(); store.db.close(); fs.rmSync(dir,{recursive:true,force:true}); });

test('migration preserves unknown historical evidence and normalizes only recognized species', () => {
  assert.equal(combat._test.db.prepare("SELECT victim_species FROM combat_events WHERE id='legacy-event'").get().victim_species,null);
  const first = event(' BP_Omniraptor_C ');
  assert.equal(combat.ingestEvent(first).event.victim_species,'omniraptor');
  assert.equal(combat.ingestEvent({...first,victimSpecies:'OMNIRAPTOR'}).duplicate,true);
  assert.equal(combat.ingestEvent({...first,victimSpecies:null}).event.victim_species,'omniraptor');
  assert.throws(()=>combat.ingestEvent({...first,victimSpecies:'Troodon'}),{code:'COMBAT_EVENT_CONFLICT'});
  assert.throws(()=>combat.ingestEvent({...first,eventId:'different-event-id',victimSpecies:'Troodon'}),{code:'COMBAT_EVENT_CONFLICT'});
  assert.equal(combat.ingestEvent(event('ImaginaryDinosaur')).event.victim_species,null);
  assert.equal(combat.ingestEvent(event(null)).event.victim_species,null);
  const old = event(null);
  combat.ingestEvent(old);
  assert.equal(combat.ingestEvent({...old,victimSpecies:'Troodon'}).event.victim_species,null);
  assert.equal(combat.ingestEvent({...old,eventId:'mixed-version-replay',victimSpecies:'Troodon'}).duplicate,true);
});

test('five distinct event-time species earn one permanent badge without XP or currency', () => {
  combat.ingestEvent(event('Omniraptor')); // Same species is not another unlock.
  combat.ingestEvent(event('Tyrannosaurus',{killerSteamId:b,victimSteamId:a}));
  combat.ingestEvent(event('Tyrannosaurus',{victimSteamId:a})); // self kill
  combat.ingestEvent(event('Tyrannosaurus',{killerSteamId:null})); // environmental
  for (const sp of ['Troodon','Gallimimus','Dryosaurus']) combat.ingestEvent(event(sp));
  assert.equal(badge(),undefined);
  const line = '[2026.10.04-03.26.00:123][101]LogTheIsleKillData: [2026.10.04-14.26.00] Hunter [76561198000001001] Dino: Tyrannosaurus, Female, 0.8 - Killed the following player: Victim, [76561198000001002], Dino: Diabloceratops, Gender: Male, Growth: 0.7, at: X=1 Y=2 Z=3';
  const fifth={eventId:'parsed-event-five',...parseCombatLine(line)};
  combat.ingestEvent(fifth);
  // Existing combat quest payouts are separate; unlocking this badge adds none.
  const balanceBeforeBadge = store.getWallet(a).balance;
  const earned = badge();
  assert.equal(earned.title,'Versatile Hunter');
  assert.equal(earned.metadata.value,5);
  assert.equal(require('../src/services/achievementSourceTime').createAchievementSourceTimeStore(store.db).read(a,'combat-species-5').sourceAt,Date.parse(fifth.occurredAt));
  assert.deepEqual(badge(),earned);
  assert.equal(progression.getProfile(b).achievements.some(x=>x.id==='combat-species-5'),false);
  assert.equal(store.getWallet(a).balance,balanceBeforeBadge);
  assert.equal(progression.getProfile(a).xp,0);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM progression_achievements WHERE steam_id=? AND achievement_id='combat-species-5'").get(a).n,1);
});
