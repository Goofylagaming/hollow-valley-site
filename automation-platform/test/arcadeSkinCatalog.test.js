'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
process.env.AUTOMATION_DB_PATH=':memory:';
const store=require('../src/services/economyStore'),catalog=require('../src/services/arcadeSkinCatalog');
const launch=require('../../scripts/configure-arcade-launch.cjs');
test('custom Arcade skins use valid native colour channels and never overwrite existing skins',()=>{
  const first=catalog.seed();assert.equal(first.created.length,3);assert.equal(catalog.seed().created.length,0);
  for(const def of catalog.definitions){const p=store.getSkinPreset(def.id);assert.equal(p.exclusive,true);assert.equal(p.published,false);assert.equal(p.isPremium,false);assert.deepEqual(p.skin,catalog.palette(def));}
  assert.deepEqual(catalog.definitions,require('../../public/assets/arcade-skins.json'));
  const id=catalog.definitions[0].id;store.db.prepare('UPDATE economy_skin_presets SET skin_json=? WHERE id=?').run('{}',id);
  assert.throws(()=>catalog.seed(),/refusing overwrite/);
  store.db.prepare('UPDATE economy_skin_presets SET skin_json=? WHERE id=?').run(JSON.stringify(catalog.palette(catalog.definitions[0])),id);
});
test('launch tables include three custom skins and safe growth entitlements, are repeatable and preserve custom configuration',()=>{
  assert.equal(launch.applyLaunchConfig().version,2);assert.equal(launch.applyLaunchConfig().alreadyConfigured,true);
  const rewards=require('../src/services/arcadeRewards'),c=rewards.config();
  assert.equal(new Set(Object.values(c.crates).flat().filter(r=>r.type==='skin').map(r=>r.presetId)).size,3);
  for(const pool of Object.values(c.crates))assert.equal(pool.reduce((n,r)=>n+r.weight,0),10000);
  c.dailyPlays=7;rewards.configure('test',c,c.version);assert.throws(()=>launch.applyLaunchConfig(),/already customized/);
});
