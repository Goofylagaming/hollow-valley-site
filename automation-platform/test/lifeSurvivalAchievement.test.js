const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'hv-life-survival-'));
process.env.AUTOMATION_DB_PATH = path.join(dir,'test.sqlite');
const store = require('../src/services/economyStore');
const progression = require('../src/services/progressionService');
const {createLegacyStore} = require('../src/services/valleyLegacyStore');
let now=Date.parse('2026-11-01T00:00:00Z');
const legacy=createLegacyStore(store.db,{now:()=>now});
test.after(()=>{store.db.close();fs.rmSync(dir,{recursive:true,force:true});});
const a='76561198000000601', b='76561198000000602', c='76561198000000603', d='76561198000000604';
const p=(steamId,species='Rex')=>({steamId,species,growth:0.5,name:'Fixture'});
const badge=id=>progression.getProfile(id).achievements.find(x=>x.id==='life-survival-10h');

test('ten hours must belong to one observed life, with saved evidence and no reward',()=>{
  // Account totals do not establish a dinosaur lifetime.
  progression.getProfile(d);
  store.db.prepare('UPDATE progression_players SET playtime_intervals=120 WHERE steam_id=?').run(d);
  assert.equal(badge(d),undefined);
  legacy.snapshot([p(a),p(b),p(c)],now);
  const originalLife=legacy.mine(a).lives[0].id;
  const start=now;
  for(let i=1;i<=119;i++) {
    now+=300000;
    legacy.snapshot([p(a),p(b,i<60?'Rex':'Trike'),p(c)],now);
  }
  assert.equal(badge(a),undefined,'9h55m is below threshold');
  assert.equal(badge(b),undefined,'different lives cannot be summed');
  now+=300000;legacy.snapshot([p(a),p(b,'Trike'),p(c)],now);
  // Recorded death is known before the periodic Legacy import.
  store.db.exec('CREATE TABLE combat_events(id TEXT PRIMARY KEY,victim_steam_id TEXT,occurred_at TEXT)');
  store.db.prepare('INSERT INTO combat_events VALUES (?,?,?)').run('late-death',c,new Date(start+18000000).toISOString());
  assert.equal(badge(c),undefined,'known death invalidates apparent continuity');
  const earned=badge(a);
  assert.equal(earned.title,'Enduring Survivor');
  assert.equal(earned.metadata.value,36000);
  assert.equal(earned.metadata.evidence.lifeId,originalLife);
  assert.equal(earned.metadata.evidence.observedThrough,now);
  now+=900001;legacy.snapshot([p(a)],now);
  assert.deepEqual(badge(a),earned,'permanent after an observation gap');
  assert.equal(store.getWallet(a).balance,0);
  assert.equal(progression.getProfile(a).xp,0);
});

test('long unobserved gaps cannot turn short observations into a ten-hour life',()=>{
  const id='76561198000000605';
  now+=60000;legacy.snapshot([p(id)],now);
  now+=36000000;legacy.snapshot([p(id)],now);
  assert.equal(badge(id),undefined);
});
