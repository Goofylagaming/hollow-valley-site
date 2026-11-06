const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const express=require('express');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hv-victory-results-'));
process.env.AUTOMATION_DB_PATH=path.join(dir,'test.sqlite');
process.env.HOLLOW_VALLEY_API_TOKEN='fixture-website-secret';
const store=require('../src/services/economyStore');
const progression=require('../src/services/progressionService');
const {createTerritoryVictoryStore}=require('../src/services/territoryVictoryStore');
const route=require('../src/routes/websiteTerritoryResultRoutes');
const a='76561198000000501',b='76561198000000502',c='76561198000000503';
const payload={version:1,attackId:1,eventId:2,startedAt:1000,resolvedAt:2000,
  provenance:'recorded-live',outcome:'capture',winners:[a,b]};
test.after(()=>{store.db.close();fs.rmSync(dir,{recursive:true,force:true});});

test('authenticated immutable result unlocks only frozen winners with no rewards',async()=>{
  const app=express();app.use(express.json());app.use('/results',route);
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const url=`http://127.0.0.1:${server.address().port}/results`;
  const post=(body,token='fixture-website-secret')=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
  try {
    assert.equal((await post(payload,'wrong')).status,401);
    for(const change of [{provenance:'simulated'},{outcome:'defence'},{winners:[]},{winners:[a,a]},{winners:['bad']},{resolvedAt:999},{version:2}]) {
      assert.equal((await post({...payload,...change})).status,400);
    }
    const first=await post(payload);assert.equal(first.status,201);assert.equal(first.headers.get('cache-control'),'no-store');
    assert.equal((await post({...payload,winners:[b,a]})).status,200);
    assert.equal((await post({...payload,winners:[a,c]})).status,409);
    assert.equal((await post({...payload,eventId:3})).status,409);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM progression_territory_results').get().n,1);
    for(const id of [a,b]) {
      const profile=progression.getProfile(id);
      assert.equal(profile.achievements.find(x=>x.id==='territory-victory').title,'Territory Victor');
      assert.equal(require('../src/services/achievementSourceTime').createAchievementSourceTimeStore(store.db).read(id,'territory-victory').sourceAt,payload.resolvedAt);
      assert.equal(profile.xp,0);assert.equal(store.getWallet(id).balance,0);
    }
    assert.equal(progression.getProfile(c).achievements.some(x=>x.id==='territory-victory'),false);
    process.env.HOLLOW_VALLEY_API_TOKEN='';
    assert.equal((await post(payload)).status,503);
  } finally {await new Promise(resolve=>server.close(resolve));}
});

test('a failed roster insert rolls back the entire result and can be retried',()=>{
  const results=createTerritoryVictoryStore(store.db);
  store.db.exec(`CREATE TRIGGER fixture_fail BEFORE INSERT ON progression_territory_winners
    WHEN NEW.attack_id=3 AND NEW.steam_id='${b}' BEGIN SELECT RAISE(ABORT,'fixture failure'); END;`);
  assert.throws(()=>results.ingest({...payload,attackId:3}),/fixture failure/);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM progression_territory_results WHERE attack_id=3').get().n,0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM progression_territory_winners WHERE attack_id=3').get().n,0);
  store.db.exec('DROP TRIGGER fixture_fail');
  assert.equal(results.ingest({...payload,attackId:3}).duplicate,false);
});
