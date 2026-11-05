const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'hv-nested-adult-'));
process.env.AUTOMATION_DB_PATH = path.join(dir,'test.sqlite');
const store = require('../src/services/economyStore');
const progression = require('../src/services/progressionService');
const { createLegacyStore } = require('../src/services/valleyLegacyStore');
let now = Date.parse('2026-11-01T00:00:00Z');
const legacy = createLegacyStore(store.db,{now:()=>now});
test.after(()=>{store.db.close();fs.rmSync(dir,{recursive:true,force:true});});
const parent = '76561198000000700';
const p=(steamId,growth)=>({steamId,growth,species:'Rex',name:'Fixture'});
legacy.snapshot([p(parent,1)],now);
const parentLife = legacy.mine(parent).lives[0].id;
const badge=id=>progression.getProfile(id).achievements.find(a=>a.id==='nested-adult');
const sample=(id,growth,gap=60000)=>{now+=gap;legacy.snapshot([p(parent,1),p(id,growth)],now);return legacy.mine(id).lives[0].id;};
const verify=child=>legacy.hatch({child,parents:[parentLife],evidence:'fixture:verified-hatch'});

test('verified juvenile-to-adult life unlocks permanently, but reservations and adult-only observations do not',()=>{
  const a='76561198000000701',b='76561198000000702';
  const life=sample(a,0.1);
  const nest=legacy.createNest(parent,{parent:parentLife,name:'Fixture nest',eggs:1});
  const request=legacy.requestEgg(a,'Fixture',nest.id);
  legacy.manageNest(parent,nest.id,{action:'accept',requestId:request.id});
  assert.equal(badge(a),undefined);
  sample(a,100);
  assert.equal(badge(a),undefined,'growth without verified parentage is insufficient');
  verify(life);
  const earned=badge(a);
  assert.equal(earned.title,'Valley Born');
  assert.equal(earned.metadata.evidence.lifeId,life);
  assert.ok(earned.metadata.evidence.adultAt>earned.metadata.evidence.juvenileAt);
  sample(a,0.1); // New life must not remove a permanent award.
  assert.deepEqual(badge(a),earned);
  assert.equal(store.getWallet(a).balance,0);
  assert.equal(progression.getProfile(a).xp,0);
  verify(sample(b,1));
  assert.equal(badge(b),undefined,'no invented juvenile history');
  assert.ok(nest);
});

test('unobserved gaps, growth resets and known deaths cannot join hatch and adulthood across lives',()=>{
  for (const [id,kind] of [['76561198000000703','gap'],['76561198000000704','reset'],['76561198000000705','death']]) {
    const child=sample(id,0.5);verify(child);
    if(kind==='gap') sample(id,1,900001);
    if(kind==='reset') {sample(id,0.1);sample(id,1);}
    if(kind==='death') {
      const deathAt=now+30000;
      sample(id,1);
      legacy.ingest({id:'delayed-child-death',type:'combat_death',steamId:id,at:deathAt});
    }
    assert.equal(badge(id),undefined,kind);
  }
});

test('malformed growth and duplicate or old samples cannot invent an adult milestone',()=>{
  const id='76561198000000706'; const child=sample(id,0.5);verify(child);
  for(const growth of [true,200,'invalid',null]) sample(id,growth);
  assert.equal(badge(id),undefined);
  legacy.snapshot([p(parent,1),p(id,1)],now);
  legacy.snapshot([p(parent,1),p(id,1)],now-1);
  assert.equal(badge(id),undefined);
  assert.equal(store.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('a known combat death blocks the badge before Legacy imports it',()=>{
  const id='76561198000000707'; const child=sample(id,0.2);verify(child);
  const deathAt=now+30000;sample(id,1);
  store.db.exec('CREATE TABLE combat_events(id TEXT PRIMARY KEY,victim_steam_id TEXT,occurred_at TEXT)');
  store.db.prepare('INSERT INTO combat_events VALUES (?,?,?)').run('unimported-death',id,new Date(deathAt).toISOString());
  assert.equal(badge(id),undefined);
});

test('only death evidence inside the awarded growth interval flags a permanent nested badge',()=>{
  const id='76561198000000701';const earned=badge(id);
  const {juvenileAt,adultAt}=earned.metadata.evidence;
  store.db.prepare('INSERT INTO combat_events VALUES (?,?,?)').run('later-life-death',id,new Date(adultAt+60000).toISOString());
  assert.equal(badge(id).verificationStatus,undefined);
  store.db.prepare('INSERT INTO combat_events VALUES (?,?,?)').run('late-growth-death',id,new Date(juvenileAt+1000).toISOString());
  assert.equal(badge(id).verificationStatus,'under-review');
  assert.equal(badge(id).unlockedAt,earned.unlockedAt);
});
