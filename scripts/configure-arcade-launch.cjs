'use strict';
// Explicit operator action, never invoked automatically on startup or deploy.
const desired=require('../automation-platform/src/data/arcade-launch-rewards.json');
function applyLaunchConfig() {
  const store=require('../automation-platform/src/services/economyStore');
  const rewards=require('../automation-platform/src/services/arcadeRewards');
  const catalog=require('../automation-platform/src/services/arcadeSkinCatalog');
  // New reward-only presets; this never changes an existing player design.
  catalog.seed();
  for(const pool of Object.values(desired.crates)) {
    if(pool.reduce((n,r)=>n+r.weight,0)!==10000)throw Error('Launch weights must total 10,000');
    for(const reward of pool.filter(r=>r.type==='skin')) {
      const p=store.getSkinPreset(reward.presetId);
      if(!p?.active||!p.exclusive||p.published||p.membershipPremium||p.create_key!==`arcade-skin:${reward.presetId}`)throw Error(`Launch skin is not the expected earned-only preset: ${reward.id}`);
    }
  }
  const current=rewards.config(),{version,...value}=current;
  if(require('node:util').isDeepStrictEqual(value,desired))return {version,alreadyConfigured:true};
  // Existing custom tables require deliberate review, never an automatic overwrite.
  if(version!==1)throw Error('Arcade configuration was already customized; review instead of overwriting');
  const result=rewards.configure('release:valley-arcade-v01',desired,version);
  return {version:result.version,alreadyConfigured:false,families:Object.keys(desired.crates)};
}
module.exports={applyLaunchConfig,desired};
if(require.main===module)console.log(JSON.stringify(applyLaunchConfig()));
