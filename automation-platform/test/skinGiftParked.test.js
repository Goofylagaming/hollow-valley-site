const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
process.env.AUTOMATION_DB_PATH=':memory:';process.env.SKIN_SYSTEM_ENABLED='true';process.env.PARKED_DINO_EDIT_ENABLED='true';process.env.SKIN_PRESET_CREATE_COST='0';
let duringRead=()=>{};const edits=[];
const storagePath=require.resolve('../src/services/dinoStorageService');
require.cache[storagePath]={id:storagePath,filename:storagePath,loaded:true,exports:{validateSlot:s=>s,getStoredDino:async()=>{duringRead();return {classPath:'/Game/BP_Triceratops.BP_Triceratops_C'};},editStoredDino:async command=>edits.push(command)}};
const store=require('../src/services/economyStore'),skins=require('../src/services/skinPresetService');
const gifts=require('../src/services/skinGiftService').createSkinGiftService(store,{enabled:()=>true});
const creator={steam_id:'76561198000000401'},sender={steam_id:'76561198000000402'},recipient={steam_id:'76561198000000403'};
test.after(()=>store.db.close());
async function fixture(){
  const skin=Object.fromEntries(skins.COLOR_KEYS.map(k=>[k,{r:0.1,g:0.2,b:0.3,a:1}]));Object.assign(skin,{skinVariation:1,patternIndex:2,themeIndex:3});
  const {preset}=await skins.createPresetFromStudio({steamId:creator.steam_id,name:'Parked gift fixture',species:'Triceratops',skin,idempotencyKey:randomUUID()});
  skins.publishPreset({presetId:preset.id,price:100});store.applyWalletTransaction({steamId:sender.steam_id,amount:100,kind:'fixture',reason:'Fixture funding',idempotencyKey:randomUUID()});
  skins.purchasePreset({steamId:sender.steam_id,presetId:preset.id,idempotencyKey:randomUUID()});return preset;
}
test('a gift accepted during the storage read prevents a former owner applying the skin',async()=>{
  const preset=await fixture();const {id}=gifts.offer(sender,{presetId:preset.id,recipientSteamId:recipient.steam_id,requestId:randomUUID()});
  duringRead=()=>gifts.decide(recipient,{id,decision:'accepted',expectedRevision:0});
  await assert.rejects(skins.applyPreset({steamId:sender.steam_id,presetId:preset.id,slot:'fixture-slot'}),{code:'SKIN_PRESET_NOT_FOUND'});
  assert.equal(edits.length,0);assert.equal(store.hasSkinUnlock(recipient.steam_id,preset.id),true);duringRead=()=>{};
});
test('a palette changed during storage lookup is rejected instead of applying stale colours',async()=>{
  const preset=await fixture();
  duringRead=()=>{const changed=structuredClone(preset.skin);changed.body.r=0.9;store.db.prepare('UPDATE economy_skin_presets SET skin_json=? WHERE id=?').run(JSON.stringify(changed),preset.id);};
  await assert.rejects(skins.applyPreset({steamId:sender.steam_id,presetId:preset.id,slot:'fixture-slot'}),{code:'SKIN_PRESET_CHANGED'});
  assert.equal(edits.length,0);duringRead=()=>{};
});
