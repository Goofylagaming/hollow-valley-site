const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'hv-prime-achievement-'));
process.env.AUTOMATION_DB_PATH = path.join(dir,'test.sqlite');
const progression = require('../src/services/progressionService');
const store = require('../src/services/economyStore');
let tracker;
test.after(() => { tracker?._test.db.close(); store.db.close(); fs.rmSync(dir,{recursive:true,force:true}); });
const a = '76561198000000801', b = '76561198000000802', c = '76561198000000803';
const badge = steam => progression.getProfile(steam).achievements.find(x=>x.id==='prime-observed');

test('Prime badge requires observed Prime, survives later lives and awards no currency or XP', () => {
  assert.equal(badge(a),undefined,'optional tracker missing');
  tracker = require('../src/services/primeTrackerService');
  const snapshot = (steamId,isPrime,minute=0,species='Tyrannosaurus') => tracker.recordSnapshot(
    [{steamId,isPrime,species,growth:1}],new Date(Date.UTC(2026,10,1,0,minute)).toISOString(),
    {env:{PRIME_TRACKER_ENABLED:'true'}});
  snapshot(a,false);
  assert.equal(badge(a),undefined,'adult growth is not Prime evidence');
  snapshot(a,true,1);
  const earned = badge(a);
  assert.equal(earned.title,'Prime Survivor');
  assert.equal(earned.metadata.value,1);
  assert.equal(require('../src/services/achievementSourceTime').createAchievementSourceTimeStore(store.db).read(a,'prime-observed').sourceAt,Date.UTC(2026,10,1,0,1));
  snapshot(a,false,2,'Gallimimus');
  assert.deepEqual(badge(a),earned,'permanent across dinosaur lives');
  assert.equal(badge(b),undefined,'account isolation');
  snapshot(b,true,3);
  const firstSeenPrime = tracker._test.activeLife(b);
  assert.equal(firstSeenPrime.prime_preexisting,1);
  assert.equal(firstSeenPrime.prime_started_at,null,'do not invent attainment time');
  snapshot(b,false,4);
  assert.equal(badge(b).title,'Prime Survivor','preexisting observation persists before first profile read');
  assert.equal(require('../src/services/achievementSourceTime').createAchievementSourceTimeStore(store.db).read(b,'prime-observed').sourceAt,Date.UTC(2026,10,1,0,3));
  snapshot(c,false,5);
  snapshot(c,true,4);
  assert.equal(badge(c),undefined,'old snapshots cannot create Prime evidence');
  assert.equal(store.getWallet(a).balance,0);
  assert.equal(progression.getProfile(a).xp,0);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM progression_achievements WHERE steam_id=? AND achievement_id='prime-observed'").get(a).n,1);
});
