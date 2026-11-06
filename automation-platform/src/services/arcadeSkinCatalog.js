'use strict';
const definitions=require('../data/arcade-skins.json');
const store=require('./economyStore');
const skins=require('./skinPresetService');
const {isDeepStrictEqual}=require('node:util');
function palette(definition) {
  return skins.sanitizeSkin({...Object.fromEntries(Object.entries(definition.colors).map(([key,hex])=>{
    const n=parseInt(hex.slice(1),16);return [key,{r:((n>>16)&255)/255,g:((n>>8)&255)/255,b:(n&255)/255,a:1}];
  })),patternIndex:definition.patternIndex,themeIndex:definition.themeIndex,skinVariation:definition.skinVariation});
}
function seed() {
  const rewards=require('./arcadeRewards');rewards.schema();
  store.db.exec('BEGIN IMMEDIATE');
  try {
    const created=[];
    for(const definition of definitions) {
      const skin=palette(definition),old=store.getSkinPreset(definition.id);
      if(old) {
        if(old.create_key!==`arcade-skin:${definition.id}`||!old.active||!old.exclusive||old.published||old.isPremium||!isDeepStrictEqual(old.skin,skin))throw Error('Arcade skin already exists with different content; refusing overwrite');
        continue;
      }
      store.db.prepare(`INSERT INTO economy_skin_presets
        (id,owner_steam_id,species,name,description,skin_json,is_premium,active,published,exclusive,price,share_code,create_key)
        VALUES (?,NULL,?,?,?,?,0,1,0,1,0,NULL,?)`).run(definition.id,definition.species,definition.name,definition.description,JSON.stringify(skin),`arcade-skin:${definition.id}`);
      created.push(definition.id);
    }
    if(created.length)store.db.prepare('INSERT INTO arcade_rewards_audit(actor,action,details_json,created_at) VALUES (?,?,?,?)')
      .run('release:valley-arcade-v01','seed_arcade_skins',JSON.stringify({created}),Date.now());
    store.db.exec('COMMIT');return {created,skins:definitions.map(d=>({id:d.id,name:d.name}))};
  }catch(e){store.db.exec('ROLLBACK');throw e;}
}
module.exports={definitions,palette,seed};
