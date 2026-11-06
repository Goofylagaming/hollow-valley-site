const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const express=require('express');
const {DatabaseSync}=require('node:sqlite');
const {createBattleProvenance}=require('../server/services/territoryBattleProvenance');
const {createVictoryOutbox}=require('../server/services/territoryVictoryOutbox');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hv-victory-delivery-'));
process.env.AUTOMATION_DB_PATH=path.join(dir,'automation.sqlite');
process.env.HOLLOW_VALLEY_API_TOKEN='fixture-delivery-token';
const route=require('../automation-platform/src/routes/websiteTerritoryResultRoutes');
const economy=require('../automation-platform/src/services/economyStore');
const progression=require('../automation-platform/src/services/progressionService');
const client=require('../server/services/automationWebsiteClient');
require('../automation-platform/src/services/valleyLegacyStore').createLegacyStore(economy.db,{now:()=>1000});
process.env.VALLEY_LEGACY_ENABLED='1';
const legacy=require('../automation-platform/src/services/valleyLegacyService');
test.after(()=>{legacy.get().db.close();economy.db.close();fs.rmSync(dir,{recursive:true,force:true});});
const a='76561198000000401',b='76561198000000402';

test('capture queues atomically and survives lost acknowledgement/restart through authenticated receiver',async()=>{
  const file=path.join(dir,'website.sqlite');let db=new DatabaseSync(file);
  const app=express();app.use(express.json());app.use('/api/website/territory-results',route);
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  process.env.AUTOMATION_SERVICE_URL=`http://127.0.0.1:${server.address().port}`;
  try {
    const evidence=createBattleProvenance(db);
    evidence.begin(1,1,1000);
    evidence.observe(1,{usable:true,participants:[{steamId:a,side:'attacker'},{steamId:b,side:'defender'}]},1500);
    db.exec('BEGIN');evidence.finish(1,2000,'capture');db.exec('ROLLBACK');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM territory_victory_outbox').get().n,0);
    db.exec('BEGIN');evidence.finish(1,2000,'capture');db.exec('COMMIT');
    let time=3000;
    const first=createVictoryOutbox(db,{now:()=>time,send:async payload=>{
      await client.postTerritoryVictory(payload);throw new Error('lost acknowledgement with secret details');
    }});
    await first.flush();
    assert.equal(db.prepare('SELECT status FROM territory_victory_outbox').get().status,'pending');
    assert.equal(db.prepare('SELECT last_error_code FROM territory_victory_outbox').get().last_error_code,'delivery-failed');
    db.close();db=new DatabaseSync(file);time+=15000;
    const retry=createVictoryOutbox(db,{now:()=>time,send:client.postTerritoryVictory});
    await retry.flush();
    assert.equal(db.prepare('SELECT status FROM territory_victory_outbox').get().status,'delivered');
    assert.equal(economy.db.prepare('SELECT COUNT(*) AS n FROM progression_territory_results').get().n,1);
    assert.equal(progression.getProfile(a).achievements.filter(x=>x.id==='territory-victory').length,1);
    assert.equal(progression.getProfile(b).achievements.some(x=>x.id==='territory-victory'),false);
    assert.equal(economy.getWallet(a).balance,0);
    legacy.reconcile();legacy.reconcile();
    const captures=economy.db.prepare("SELECT subject,value FROM vl_records WHERE scope='all' AND metric='territory_captures'").all();
    assert.equal(captures.length,1);assert.equal(captures[0].subject,a);assert.equal(captures[0].value,1);
    assert.equal(legacy.get().overview().rankings.all.find(r=>r.metric==='territory_captures').leaders[0].value,1);
    await retry.flush();
    assert.equal(db.prepare('SELECT attempts FROM territory_victory_outbox').get().attempts,2);
  } finally {await new Promise(resolve=>server.close(resolve));db.close();}
});

test('conflicting results are retained for review while unrelated delivery continues',async()=>{
  const db=new DatabaseSync(':memory:');
  try {
    const q=createVictoryOutbox(db,{now:()=>10000,send:async p=>{
      if(p.attackId===1) throw Object.assign(new Error('sensitive details'),{status:409});
      return {accepted:true,attackId:p.attackId};
    }});
    q.enqueue({attackId:1});q.enqueue({attackId:2});
    await q.flush();
    assert.equal(db.prepare('SELECT status FROM territory_victory_outbox WHERE attack_id=1').get().status,'review');
    assert.equal(db.prepare('SELECT status FROM territory_victory_outbox WHERE attack_id=2').get().status,'delivered');
    assert.throws(()=>q.enqueue({attackId:1,changed:true}),/conflict/);
  } finally {db.close();}
});
