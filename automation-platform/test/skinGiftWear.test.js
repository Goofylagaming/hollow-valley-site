const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
process.env.AUTOMATION_DB_PATH=':memory:';process.env.SKIN_SYSTEM_ENABLED='true';process.env.SKIN_LIVE_WEAR_ENABLED='true';process.env.SKIN_PRESET_CREATE_COST='0';
const stub=(name,exports)=>{const id=require.resolve('../src/services/'+name);require.cache[id]={id,filename:id,loaded:true,exports};};
stub('dinoStorageService',{});
const queued=[];let duringSnapshot=()=>{};
stub('statusService',{getServerSnapshot:async()=>{duringSnapshot();return {online:true,characters:[]};}});
stub('commandBridgeService',{buildCommand:()=>({id:randomUUID()}),queueCommand:async command=>queued.push(command),readOutcome:async()=>({state:'confirmed'})});
const store=require('../src/services/economyStore'),skins=require('../src/services/skinPresetService'),wear=require('../src/services/skinWearService');
const gifts=require('../src/services/skinGiftService').createSkinGiftService(store,{enabled:()=>true});
const creator={steam_id:'76561198000000301'},sender={steam_id:'76561198000000302'},recipient={steam_id:'76561198000000303'};
test.after(()=>store.db.close());
async function fixture(){
  const skin=Object.fromEntries(skins.COLOR_KEYS.map(k=>[k,{r:0.1,g:0.2,b:0.3,a:1}]));Object.assign(skin,{skinVariation:1,patternIndex:2,themeIndex:3});
  const {preset}=await skins.createPresetFromStudio({steamId:creator.steam_id,name:'Wear gift fixture',species:'Triceratops',skin,idempotencyKey:randomUUID()});
  skins.publishPreset({presetId:preset.id,price:100});store.applyWalletTransaction({steamId:sender.steam_id,amount:100,kind:'fixture',reason:'Fixture funding',idempotencyKey:randomUUID()});
  skins.purchasePreset({steamId:sender.steam_id,presetId:preset.id,idempotencyKey:randomUUID()});
  const {id}=gifts.offer(sender,{presetId:preset.id,recipientSteamId:recipient.steam_id,requestId:randomUUID()});return {preset,id};
}
test('a transfer committed during the snapshot wait prevents the former owner queueing a skin command',async()=>{
  const {preset,id}=await fixture();duringSnapshot=()=>gifts.decide(recipient,{id,decision:'accepted',expectedRevision:0});
  await assert.rejects(wear.wearPreset({steamId:sender.steam_id,presetId:preset.id}),{code:'SKIN_PRESET_NOT_FOUND'});
  assert.equal(queued.length,0);assert.equal(store.listSkinApplyJobs(sender.steam_id).length,0);
  assert.equal(store.hasSkinUnlock(recipient.steam_id,preset.id),true);duringSnapshot=()=>{};
});
test('a queued application prevents acceptance until its outcome is terminal',async()=>{
  const {preset,id}=await fixture(),job=randomUUID();
  store.createSkinApplyJob({id:job,steamId:sender.steam_id,presetId:preset.id,species:preset.species,skin:preset.skin});
  assert.throws(()=>gifts.decide(recipient,{id,decision:'accepted',expectedRevision:0}),{status:409});
  assert.equal(store.hasSkinUnlock(sender.steam_id,preset.id),true);
  store.updateSkinApplyJob({id:job,status:'verified',completed:true});
  gifts.decide(recipient,{id,decision:'accepted',expectedRevision:0});assert.equal(store.hasSkinUnlock(recipient.steam_id,preset.id),true);
  assert.equal(queued.length,0);
});
