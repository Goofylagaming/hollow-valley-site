const test=require('node:test'),assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
process.env.AUTOMATION_DB_PATH=':memory:';
process.env.SKIN_SYSTEM_ENABLED='true';process.env.SKIN_PRESET_CREATE_COST='0';
const storagePath=require.resolve('../src/services/dinoStorageService');
require.cache[storagePath]={id:storagePath,filename:storagePath,loaded:true,exports:{}};
const store=require('../src/services/economyStore'),skins=require('../src/services/skinPresetService');
const {createSkinPromoService}=require('../src/services/skinPromoService');
let now=Date.parse('2026-11-05T00:00:00Z'),on=true;
const promo=createSkinPromoService(store,{now:()=>now,enabled:()=>on});
const admin={steam_id:'76561198000000801',is_admin:true},member={steam_id:'76561198000000802'},other={steam_id:'76561198000000803'};
test.after(()=>store.db.close());
async function fixture(){
  const skin=Object.fromEntries(skins.COLOR_KEYS.map(k=>[k,{r:0.2,g:0.3,b:0.4,a:1}]));Object.assign(skin,{skinVariation:1,patternIndex:2,themeIndex:3});
  const preset=(await skins.createPresetFromStudio({steamId:admin.steam_id,species:'Triceratops',name:'Promo fixture',skin,idempotencyKey:randomBytes(12).toString('hex')})).preset;
  const input={presetId:preset.id,code:`HVP-${randomBytes(32).toString('hex')}`,reason:'Competition prize approved by creator',expiresAt:now+86400000,requestId:randomBytes(12).toString('hex')};
  return {preset,input};
}
test('single-use redemption grants normal access once without copying skins or paying coins',async()=>{
  const {preset,input}=await fixture();const issued=promo.issue(admin,input);
  assert.equal(promo.issue(admin,input).duplicate,true);
  assert.throws(()=>skins.getPresetForPlayer(member.steam_id,preset.id));
  const count=store.db.prepare('SELECT COUNT(*) n FROM economy_skin_presets').get().n;
  assert.equal(promo.redeem(member,{code:input.code}).duplicate,false);
  assert.equal(skins.getPresetForPlayer(member.steam_id,preset.id).id,preset.id);
  assert.equal(promo.redeem(member,{code:input.code}).duplicate,true);
  assert.throws(()=>promo.redeem(other,{code:input.code}),{status:409});
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM economy_skin_presets').get().n,count);
  assert.equal(store.getWallet(member.steam_id).balance,0);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM economy_wallet_ledger WHERE steam_id=?').get(member.steam_id).n,0);
  const row=store.db.prepare('SELECT * FROM economy_skin_promos WHERE code_hash=?').get(issued.id);
  assert.equal(JSON.stringify(row).includes(input.code),false);
  assert.equal(JSON.stringify(promo.list(admin)).includes(member.steam_id),false);
  assert.throws(()=>promo.revoke(admin,{id:issued.id,reason:'Cannot revoke already redeemed code'}),{status:409});
});
test('existing ownership leaves the code available for another recipient',async()=>{
  const {preset,input}=await fixture();promo.issue(admin,input);
  assert.equal(promo.redeem(admin,{code:input.code}).alreadyOwned,true);
  assert.equal(promo.redeem(other,{code:input.code}).duplicate,false);
  assert.equal(store.hasSkinUnlock(other.steam_id,preset.id),true);
});
test('issuance is admin and creator restricted, and rejects conflicting retries',async()=>{
  const {input}=await fixture();
  assert.throws(()=>promo.issue(member,input),{status:403});
  assert.throws(()=>promo.issue({...other,is_admin:true},input),{status:403});
  assert.throws(()=>promo.issue(admin,{...input,code:'guessable'}),{status:400});
  promo.issue(admin,input);
  assert.throws(()=>promo.issue(admin,{...input,reason:'Different issuance reason'}),{status:409});
  assert.throws(()=>promo.issue(admin,{...input,requestId:'different-request'}),{status:409});
  assert.throws(()=>promo.list(member),{status:403});
});
test('expiry, revocation, changed skins and disabled rollout do not grant ownership',async()=>{
  const expired=await fixture();promo.issue(admin,expired.input);now=expired.input.expiresAt;
  assert.throws(()=>promo.redeem(member,{code:expired.input.code}),{status:409});
  const revoked=await fixture(),id=promo.issue(admin,revoked.input).id;
  const revocation={id,reason:'Competition cancelled before redemption'};
  promo.revoke(admin,revocation);assert.equal(promo.revoke(admin,revocation).duplicate,true);
  assert.throws(()=>promo.redeem(member,{code:revoked.input.code}),{status:409});
  const changed=await fixture();promo.issue(admin,changed.input);
  store.db.prepare('UPDATE economy_skin_presets SET species=? WHERE id=?').run('Carnotaurus',changed.preset.id);
  assert.throws(()=>promo.redeem(member,{code:changed.input.code}),{status:409});
  on=false;assert.throws(()=>promo.issue(admin,changed.input),{status:503});assert.throws(()=>promo.redeem(member,{code:changed.input.code}),{status:503});on=true;
  for(const item of [expired,revoked,changed])assert.equal(store.hasSkinUnlock(member.steam_id,item.preset.id),false);
});
test('membership skins cannot bypass their claim and review workflow',()=>{
  const premium=require('../src/services/premiumSkinService');
  const preset=premium.seedDrafts({ownerSteamId:admin.steam_id}).skins[0];
  assert.throws(()=>promo.issue(admin,{presetId:preset.presetId,code:`HVP-${randomBytes(32).toString('hex')}`,reason:'Membership exclusion test',requestId:'membership-test',expiresAt:now+10000}),{status:409});
});
