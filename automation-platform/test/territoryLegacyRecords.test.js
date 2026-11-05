const test=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {createLegacyStore}=require('../src/services/valleyLegacyStore');
const {createTerritoryVictoryStore}=require('../src/services/territoryVictoryStore');
const {reconcileTerritoryCaptures}=require('../src/services/territoryLegacyRecords');
const a='76561198000000771',b='76561198000000772',c='76561198000000773';
function fixture() {
  const db=new DatabaseSync(':memory:');let at=100000;
  const legacy=createLegacyStore(db,{now:()=>at});
  const source=createTerritoryVictoryStore(db,{now:()=>at});
  const capture=(attackId,resolvedAt,winners=[a,b])=>source.ingest({version:1,attackId,eventId:1,startedAt:resolvedAt-1000,resolvedAt,provenance:'recorded-live',outcome:'capture',winners});
  const count=(steam,scope='all')=>db.prepare("SELECT value FROM vl_records WHERE metric='territory_captures' AND subject=? AND scope=?").get(steam,scope)?.value||0;
  return {db,legacy,source,capture,count,time:value=>at=value};
}
test('verified capture participants enter seasonal and all-time records exactly once',()=>{
  const f=fixture();try {
    f.legacy.snapshot([{steamId:a,name:'Alpha',species:'Rex',growth:0.5}],100000);
    f.capture(1,99000); // Before tracking began: no historical backfill.
    f.time(102000);f.capture(2,101000);f.capture(3,102000,[a,c]);
    reconcileTerritoryCaptures(f.legacy);reconcileTerritoryCaptures(f.legacy);
    const season=f.legacy.overview().seasons[0].id;
    assert.equal(f.count(a),2);assert.equal(f.count(b),1);assert.equal(f.count(c),1);
    assert.equal(f.count(a,season),2);
    const leaders=f.legacy.overview().rankings.all.find(r=>r.metric==='territory_captures').leaders;
    assert.equal(leaders[0].name,'Alpha');assert.equal(leaders[0].value,2);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM vl_events').get().n,4);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM vl_imports').get().n,2);
    f.time(103000);f.legacy.rotate('Next season');f.time(104000);f.capture(4,104000,[b]);
    reconcileTerritoryCaptures(f.legacy);
    assert.equal(f.count(b),2);assert.equal(f.count(a,f.legacy.overview().seasons[0].id),0);
    assert.equal(f.legacy.overview().hallOfFame[0].winners.find(r=>r.metric==='territory_captures').value,2);
    // Delayed results do not mutate a closed season or silently inflate all-time totals.
    f.capture(5,102500,[a]);reconcileTerritoryCaptures(f.legacy);
    assert.equal(f.count(a),2);
    assert.match(f.db.prepare("SELECT error FROM vl_imports WHERE id='5'").get().error,/closed season/);
  } finally {f.db.close();}
});
test('partial importer failure can restart without double-counting or name conflicts',()=>{
  const f=fixture();try {
    f.time(101000);f.capture(1,101000);
    const ingest=f.legacy.ingest;let failed=false;
    f.legacy.ingest=event=>{if(event.steamId===b&&!failed){failed=true;throw new Error('temporary failure');}return ingest(event);};
    assert.throws(()=>reconcileTerritoryCaptures(f.legacy),/temporary failure/);
    assert.equal(f.count(a),1);assert.equal(f.count(b),0);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM vl_imports').get().n,0);
    f.legacy.snapshot([{steamId:a,name:'Changed name',species:'Rex',growth:0.5}],101000);
    reconcileTerritoryCaptures(f.legacy);
    assert.equal(f.count(a),1);assert.equal(f.count(b),1);
    assert.equal(f.db.prepare('SELECT error FROM vl_imports').get().error,null);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'economy_%'").get().n,0,'records do not require or write wallets');
  } finally {f.db.close();}
});
test('missing producer is harmless and unsupported evidence is retained for review',()=>{
  const db=new DatabaseSync(':memory:');try {
    const legacy=createLegacyStore(db,{now:()=>1000});reconcileTerritoryCaptures(legacy);
    createTerritoryVictoryStore(db);
    db.prepare('INSERT INTO progression_territory_results VALUES (?,?,?,?)').run(1,1,JSON.stringify({resolvedAt:1001,outcome:'defence'}),1001);
    reconcileTerritoryCaptures(legacy);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM vl_records').get().n,0);
    assert.match(db.prepare('SELECT error FROM vl_imports').get().error,/Unsupported/);
  }finally{db.close();}
});
