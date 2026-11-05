const test=require('node:test'),assert=require('node:assert/strict');
test('startup and scheduled retention remove expired routes despite stopped snapshots and failed event import',()=>{
  const keys=['AUTOMATION_DB_PATH','VALLEY_LEGACY_ENABLED','JOURNEY_HISTORY_ENABLED'],saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  process.env.AUTOMATION_DB_PATH=':memory:';process.env.VALLEY_LEGACY_ENABLED='1';process.env.JOURNEY_HISTORY_ENABLED='0';
  const schedule=global.setInterval,log=console.error,errors=[];let callback,delay,unref=false,store;
  global.setInterval=(fn,ms)=>{callback=fn;delay=ms;return {unref(){unref=true;}};};console.error=(...args)=>errors.push(args);
  try {
    const service=require('../src/services/valleyLegacyService');store=service.get();
    const now=Date.now(),old=now-31*86400000,steam='76561198000000801';
    const insert=store.db.prepare('INSERT INTO journey_points VALUES (?,?,?,?,?,?)');
    insert.run(steam,'old',old,1,2,1);insert.run(steam,'recent',now-1000,3,4,1);
    const discoverySample=store.db.prepare('INSERT INTO discovery_last_samples VALUES (?,?,?,?,?,?)');
    discoverySample.run(steam,'fixture','life',now-121000,1,2);
    store.db.prepare('INSERT INTO discovery_visits VALUES (?,?,?,?)').run(steam,'fixture','cave',old);
    // A malformed source fixture deliberately causes import to fail each tick.
    store.db.exec('CREATE TABLE combat_events(id TEXT)');
    service.start();assert.equal(delay,15000);assert.equal(unref,true);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM discovery_last_samples').get().n,0);
    discoverySample.run(steam,'fixture','life',now-121000,1,2);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM journey_points').get().n,1);
    insert.run(steam,'old-again',old+1,5,6,1);callback();
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM discovery_last_samples').get().n,0);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM discovery_visits').get().n,1);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM journey_points').get().n,1);
    assert.equal(store.db.prepare('SELECT life_id FROM journey_points').get().life_id,'recent');
    assert.equal(errors.filter(e=>String(e[0]).includes('reconciliation failed')).length,2);
    assert.equal(errors.filter(e=>String(e[0]).includes('cleanup failed')).length,0);
  } finally {global.setInterval=schedule;console.error=log;store?.db.close();for(const [k,v]of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
