const test=require('node:test');
const assert=require('node:assert/strict');
process.env.AUTOMATION_DB_PATH=':memory:';
process.env.SKIN_SYSTEM_ENABLED='true';
process.env.MEMBERSHIP_PREMIUM_SKINS_ENABLED='true';
const storagePath=require.resolve('../src/services/dinoStorageService');
require.cache[storagePath]={id:storagePath,filename:storagePath,loaded:true,exports:{validateSlot:(value)=>value}};
const store=require('../src/services/economyStore');
const skins=require('../src/services/skinPresetService');
const premium=require('../src/services/premiumSkinService');
const OWNER='76561198000000001';const MEMBER='76561198000000002';const OTHER='76561198000000003';
function reset(){
  process.env.MEMBERSHIP_PREMIUM_SKINS_ENABLED='true';
  store.db.exec('DELETE FROM economy_membership_skin_claims; DELETE FROM economy_membership_skin_catalog; DELETE FROM economy_skin_unlocks; DELETE FROM economy_skin_grants; DELETE FROM economy_skin_presets; DELETE FROM economy_wallets;');
}
function draft(){return premium.seedDrafts({ownerSteamId:OWNER}).skins[0];}
function publish(skin){
  premium.verifyDraft({skinId:skin.id,actorSteamId:OWNER,verifiedSpecies:['Tyrannosaurus','Deinosuchus'],note:'Checked this exact palette on live test dinosaurs with both supported species.',confirmedInGame:true,expectedVersion:skin.version});
  premium.setPublished({skinId:skin.id,actorSteamId:OWNER,published:true});
}
test('starter palette drafts are idempotent, private, and never free/public legacy skins',()=>{
  reset();const first=premium.seedDrafts({ownerSteamId:OWNER});const second=premium.seedDrafts({ownerSteamId:OWNER});
  assert.equal(first.skins.length,3);assert.deepEqual(first.skins.map(x=>x.id),second.skins.map(x=>x.id));
  assert.equal(premium.listCatalog().skins.length,0);assert.equal(skins.listStore().length,0);
  assert.deepEqual(first.skins.map(x=>x.name),['Ashfall','Moonlit Marsh','Valley Royalty']);
  for(const skin of first.skins){
    const preset=store.getSkinPreset(skin.presetId);
    assert.equal(preset.membershipPremium,true);assert.equal(preset.isPremium,false);assert.equal(preset.published,false);assert.equal(preset.exclusive,true);assert.equal(preset.share_code,null);
    assert.doesNotThrow(()=>skins.sanitizeSkin(preset.skin));
    assert.throws(()=>skins.getPresetForPlayer(MEMBER,preset.id),{code:'SKIN_PRESET_NOT_FOUND'});
  }
});
test('public catalogue returns palette cards and no full skin data or admin verification notes',()=>{
  reset();const skin=draft();publish(skin);const card=premium.listCatalog(MEMBER).skins[0];
  assert.equal(card.premium,true);assert.equal(card.owned,false);assert.equal(card.previewType,'palette');
  assert.equal(card.skin,undefined);assert.equal(card.skin_json,undefined);assert.equal(card.verificationNote,undefined);assert.equal(card.share_code,undefined);
  assert.deepEqual(card.verifiedSpecies,['Tyrannosaurus','Deinosuchus']);assert.equal(card.swatches.length,6);
});
test('publication requires explicit verification of exact draft and real species names',()=>{
  reset();const skin=draft();
  assert.throws(()=>premium.setPublished({skinId:skin.id,actorSteamId:OWNER,published:true}),{code:'PREMIUM_VERIFICATION_REQUIRED'});
  assert.throws(()=>premium.verifyDraft({skinId:skin.id,actorSteamId:OWNER,verifiedSpecies:['Tyrannosaurus'],note:'Checked in-game appearance.'}),{code:'PREMIUM_VERIFICATION_REQUIRED'});
  assert.throws(()=>premium.verifyDraft({skinId:skin.id,actorSteamId:OWNER,verifiedSpecies:['Universal'],note:'Checked in-game appearance.',confirmedInGame:true,expectedVersion:skin.version}),{code:'PREMIUM_SPECIES_REQUIRED'});
  assert.throws(()=>premium.fulfillClaim({claimId:'claim_unverified',steamId:MEMBER,skinId:skin.id}),{code:'PREMIUM_SKIN_UNAVAILABLE'});
  assert.equal(store.db.prepare('SELECT count(*) n FROM economy_skin_unlocks').get().n,0);
});
test('claim grant is permanent and exactly once, including retry after archival or disabled rollout',()=>{
  reset();const skin=draft();publish(skin);
  const first=premium.fulfillClaim({claimId:'claim_monthly_001',steamId:MEMBER,skinId:skin.id});
  assert.equal(first.duplicate,false);assert.equal(first.alreadyOwned,false);assert.equal(first.preset.owned,true);
  premium.setPublished({skinId:skin.id,actorSteamId:OWNER,published:false});
  process.env.MEMBERSHIP_PREMIUM_SKINS_ENABLED='false';
  const retry=premium.fulfillClaim({claimId:'claim_monthly_001',steamId:MEMBER,skinId:skin.id});
  assert.equal(retry.duplicate,true);assert.equal(retry.alreadyOwned,false);
  assert.equal(store.db.prepare('SELECT count(*) n FROM economy_skin_unlocks').get().n,1);
  assert.equal(store.db.prepare('SELECT count(*) n FROM economy_membership_skin_claims').get().n,1);
  assert.equal(skins.getPresetForPlayer(MEMBER,skin.presetId).owned,true);
  assert.equal(skins.listAvailablePresets(MEMBER).length,1);
  assert.equal(store.getWallet(MEMBER).balance,0);
});
test('reusing another claim id is rejected and choosing an owned skin does not grant a second receipt',()=>{
  reset();const skin=draft();publish(skin);premium.fulfillClaim({claimId:'claim_unique_001',steamId:MEMBER,skinId:skin.id});
  assert.throws(()=>premium.fulfillClaim({claimId:'claim_unique_001',steamId:OTHER,skinId:skin.id}),{code:'PREMIUM_CLAIM_CONFLICT'});
  const owned=premium.fulfillClaim({claimId:'claim_unique_002',steamId:MEMBER,skinId:skin.id});
  assert.equal(owned.alreadyOwned,true);assert.equal(store.db.prepare('SELECT count(*) n FROM economy_membership_skin_claims').get().n,1);
});
test('unclaimed skins cannot bypass membership through ordinary buy, share, grant or publication',async()=>{
  reset();const skin=draft();publish(skin);const preset=store.getSkinPreset(skin.presetId);
  assert.throws(()=>skins.purchasePreset({steamId:MEMBER,presetId:skin.presetId,idempotencyKey:'bypass_buy_001'}),{code:'SKIN_PRESET_NOT_FOUND'});
  assert.throws(()=>skins.publishPreset({presetId:skin.presetId,published:true,price:0}),{code:'PREMIUM_SKIN_MANAGED'});
  assert.throws(()=>skins.grantExclusivePreset({presetId:skin.presetId,steamId:MEMBER}),{code:'PREMIUM_SKIN_MANAGED'});
  assert.throws(()=>skins.getSharedPreset(preset.share_code||'HV-NOPE1-NOPE2'),{code:'SKIN_SHARE_NOT_FOUND'});
  await assert.rejects(()=>skins.importSharedPreset({steamId:MEMBER,shareCode:'HV-NOPE1-NOPE2',idempotencyKey:'bypass_import_001'}),{code:'SKIN_SHARE_NOT_FOUND'});
  assert.equal(skins.listAvailablePresets(MEMBER).length,0);
});
test('reviewed presets cannot be changed or removed through ordinary account editing',()=>{
  reset();const skin=draft();publish(skin);const preset=store.getSkinPreset(skin.presetId);
  assert.throws(()=>premium.updateDraft({skinId:skin.id,actorSteamId:OWNER,species:'Universal',name:'Changed',skin:preset.skin}),{code:'PREMIUM_SKIN_IMMUTABLE'});
  assert.throws(()=>skins.updatePreset({steamId:OWNER,presetId:preset.id,species:'Universal',name:'Changed',skin:preset.skin}),{code:'PREMIUM_SKIN_MANAGED'});
  assert.throws(()=>skins.deletePreset({steamId:OWNER,presetId:preset.id}),{code:'PREMIUM_SKIN_MANAGED'});
  assert.equal(store.getSkinPreset(preset.id).name,'Ashfall');
});
test('premium compatibility permits reviewed species only while creators can test drafts',()=>{
  reset();const skin=draft();const draftPreset=store.getSkinPreset(skin.presetId);
  assert.doesNotThrow(()=>skins.assertMembershipSpecies(draftPreset,OWNER,'Omniraptor'));
  publish(skin);premium.fulfillClaim({claimId:'claim_species_001',steamId:MEMBER,skinId:skin.id});
  const owned=skins.getPresetForPlayer(MEMBER,skin.presetId);
  assert.doesNotThrow(()=>skins.assertMembershipSpecies(owned,MEMBER,'BP_Tyrannosaurus_C'));
  assert.throws(()=>skins.assertMembershipSpecies(owned,MEMBER,'Omniraptor'),{code:'PREMIUM_SKIN_SPECIES_UNVERIFIED'});
});
test('drafting a saved design makes a private copy and requires its owner',async()=>{
  reset();const reference=draft();const saved=await skins.createPresetFromStudio({steamId:OWNER,species:'Universal',name:'My own palette',skin:reference.skin,idempotencyKey:'original_source_001'});
  assert.throws(()=>premium.draftFromPreset({ownerSteamId:OTHER,presetId:saved.preset.id,collection:'monthly-custom'}),{code:'PREMIUM_SOURCE_INVALID'});
  const created=premium.draftFromPreset({ownerSteamId:OWNER,presetId:saved.preset.id,collection:'monthly-custom'});
  assert.notEqual(created.skin.presetId,saved.preset.id);assert.equal(store.getSkinPreset(saved.preset.id).exclusive,false);
  assert.equal(created.skin.state,'draft');
});
test('rollout disabled blocks new grants without affecting owned skins',()=>{
  reset();const skin=draft();publish(skin);process.env.MEMBERSHIP_PREMIUM_SKINS_ENABLED='false';
  assert.equal(premium.listCatalog(MEMBER).enabled,false);
  assert.throws(()=>premium.fulfillClaim({claimId:'claim_disabled_001',steamId:MEMBER,skinId:skin.id}),{code:'PREMIUM_SKINS_DISABLED'});
  assert.equal(store.db.prepare('SELECT count(*) n FROM economy_skin_unlocks').get().n,0);
});
test('verification rejects a stale draft after another edit',()=>{
  reset();const skin=draft();
  premium.updateDraft({skinId:skin.id,actorSteamId:OWNER,species:'Universal',name:'Revised Ashfall',description:'Revised palette',skin:skin.skin});
  assert.throws(()=>premium.verifyDraft({skinId:skin.id,actorSteamId:OWNER,verifiedSpecies:['Tyrannosaurus'],note:'Checked this exact palette in-game.',confirmedInGame:true,expectedVersion:skin.version}),{code:'PREMIUM_DRAFT_CHANGED'});
  assert.equal(premium.listCatalog().skins.length,0);
});

test('profile collections count explicit ownership and active grants without exposing drafts or writing data',()=>{
  reset();const drafts=premium.seedDrafts({ownerSteamId:OWNER}).skins;
  publish(drafts[0]);publish(drafts[1]);
  premium.fulfillClaim({claimId:'collection_claim_001',steamId:MEMBER,skinId:drafts[0].id});
  store.grantSkinPreset({steamId:MEMBER,presetId:drafts[1].presetId,grantedBySteamId:OWNER,note:'Fixture personal grant'});
  const before=store.db.prepare('SELECT total_changes() n').get().n;
  const mine=premium.profileCollections(MEMBER).collections[0];
  assert.equal(mine.total,2);assert.equal(mine.owned,2);
  assert.deepEqual(mine.skins.map(s=>s.ownership).sort(),['granted','unlocked']);
  assert.equal(premium.profileCollections(OTHER).collections[0].owned,0);
  assert.equal(premium.profileCollections(OWNER).collections[0].owned,2);
  for(const skin of mine.skins){assert.equal(skin.skin,undefined);assert.equal(skin.share_code,undefined);assert.equal(skin.verificationNote,undefined);}
  assert.equal(store.db.prepare('SELECT total_changes() n').get().n,before);
  store.db.prepare("UPDATE economy_skin_grants SET revoked_at=datetime('now') WHERE steam_id=?").run(MEMBER);
  assert.equal(premium.profileCollections(MEMBER).collections[0].owned,1);
  assert.equal(premium.profileCollections(MEMBER).collections[0].skins.find(s=>s.id===drafts[1].id).ownership,null);
  premium.setPublished({skinId:drafts[0].id,actorSteamId:OWNER,published:false});
  const archived=premium.profileCollections(MEMBER).collections[0].skins.find(s=>s.id===drafts[0].id);
  assert.equal(archived.owned,true);assert.equal(archived.archived,true);
  assert.equal(premium.profileCollections(OTHER).collections[0].skins.some(s=>s.id===drafts[0].id),false);
});

test('rarity is explicitly classified with revision checks and immutable decisions without altering skins or entitlements',()=>{
  reset();const skin=draft();publish(skin);
  assert.equal(premium.listCatalog(MEMBER).skins[0].rarity,null);
  const before={preset:store.db.prepare('SELECT * FROM economy_skin_presets WHERE id=?').get(skin.presetId),catalog:store.db.prepare('SELECT * FROM economy_membership_skin_catalog WHERE id=?').get(skin.id),wallets:store.db.prepare('SELECT * FROM economy_wallets').all()};
  const input={skinId:skin.id,actorSteamId:OWNER,rarity:'rare',reason:'Limited curated collection classification',expectedRevision:0,requestId:'rarity-request-1'};
  assert.throws(()=>premium.setRarity({...input,rarity:'mythic'}),{code:'SKIN_CLASSIFICATION_INVALID'});
  assert.throws(()=>premium.setRarity({...input,reason:'short'}),{code:'SKIN_CLASSIFICATION_INVALID'});
  assert.equal(premium.setRarity(input).duplicate,false);assert.equal(premium.setRarity(input).duplicate,true);
  assert.throws(()=>premium.setRarity({...input,rarity:'epic'}),{status:409});
  assert.throws(()=>premium.setRarity({...input,requestId:'rarity-request-stale'}),{status:409});
  const publicCard=premium.listCatalog(MEMBER).skins[0];assert.equal(publicCard.rarity,'rare');assert.equal(publicCard.rarityHistory,undefined);
  const adminCard=premium.listCatalog(OWNER,{admin:true}).skins.find(s=>s.id===skin.id);
  assert.equal(adminCard.rarityRevision,1);assert.equal(adminCard.rarityHistory[0].actor,OWNER);assert.equal(adminCard.rarityHistory[0].reason,input.reason);
  assert.equal(premium.profileCollections(MEMBER).collections[0].skins[0].rarity,'rare');
  premium.setRarity({...input,rarity:null,expectedRevision:1,requestId:'rarity-request-clear'});
  premium.setRarity(input);assert.equal(premium.listCatalog(MEMBER).skins[0].rarity,null,'old replay cannot reverse a newer classification');
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM economy_skin_classification_actions WHERE preset_id=?').get(skin.presetId).n,2);
  assert.deepEqual(store.db.prepare('SELECT * FROM economy_skin_presets WHERE id=?').get(skin.presetId),before.preset);
  assert.deepEqual(store.db.prepare('SELECT * FROM economy_membership_skin_catalog WHERE id=?').get(skin.id),before.catalog);
  assert.deepEqual(store.db.prepare('SELECT * FROM economy_wallets').all(),before.wallets);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM economy_skin_unlocks').get().n,0);
});
