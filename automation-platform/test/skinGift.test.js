const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
process.env.AUTOMATION_DB_PATH=':memory:';process.env.SKIN_SYSTEM_ENABLED='true';process.env.SKIN_PRESET_CREATE_COST='0';
const storagePath=require.resolve('../src/services/dinoStorageService');require.cache[storagePath]={id:storagePath,filename:storagePath,loaded:true,exports:{}};
const store=require('../src/services/economyStore'),skins=require('../src/services/skinPresetService');
let now=Date.parse('2026-11-05T00:00:00Z'),on=true;
const gifts=require('../src/services/skinGiftService').createSkinGiftService(store,{now:()=>now,enabled:()=>on});
const creator={steam_id:'76561198000000601'},sender={steam_id:'76561198000000602'},recipient={steam_id:'76561198000000603'},other={steam_id:'76561198000000604'};
test.after(()=>store.db.close());
async function fixture(){
  const skin=Object.fromEntries(skins.COLOR_KEYS.map(k=>[k,{r:0.2,g:0.3,b:0.4,a:1}]));Object.assign(skin,{skinVariation:1,patternIndex:2,themeIndex:3});
  const preset=(await skins.createPresetFromStudio({steamId:creator.steam_id,species:'Triceratops',name:'Gift fixture',skin,idempotencyKey:randomUUID()})).preset;
  skins.publishPreset({presetId:preset.id,price:100});
  store.applyWalletTransaction({steamId:sender.steam_id,amount:100,kind:'fixture',reason:'Fixture funds',idempotencyKey:randomUUID()});
  skins.purchasePreset({steamId:sender.steam_id,presetId:preset.id,idempotencyKey:randomUUID()});
  return {preset,input:{presetId:preset.id,recipientSteamId:recipient.steam_id,requestId:randomUUID(),note:'A gift for you'}};
}
test('offers retain sender ownership and acceptance moves exactly one receipt without coins or copies',async()=>{
  const {preset,input}=await fixture();
  const before=store.db.prepare('SELECT * FROM economy_skin_unlocks WHERE preset_id=?').get(preset.id);
  const ledger=store.db.prepare('SELECT COUNT(*) n FROM economy_wallet_ledger').get().n;
  const {id}=gifts.offer(sender,input);assert.equal(gifts.offer(sender,input).duplicate,true);
  assert.equal(store.hasSkinUnlock(sender.steam_id,preset.id),true);assert.equal(store.hasSkinUnlock(recipient.steam_id,preset.id),false);
  assert.equal(gifts.list(other).gifts.length,0);
  assert.throws(()=>gifts.decide(other,{id,decision:'accepted',expectedRevision:0}),{status:404});
  assert.throws(()=>gifts.decide(sender,{id,decision:'accepted',expectedRevision:0}),{status:404});
  assert.equal(gifts.decide(recipient,{id,decision:'accepted',expectedRevision:0}).duplicate,false);
  assert.equal(gifts.decide(recipient,{id,decision:'accepted',expectedRevision:0}).duplicate,true);
  const rows=store.db.prepare('SELECT * FROM economy_skin_unlocks WHERE preset_id=?').all(preset.id);
  assert.equal(rows.length,1);assert.deepEqual({...rows[0],steam_id:before.steam_id},{...before});
  assert.equal(rows[0].steam_id,recipient.steam_id);
  assert.throws(()=>skins.getPresetForPlayer(sender.steam_id,preset.id));assert.equal(skins.getPresetForPlayer(recipient.steam_id,preset.id).id,preset.id);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM economy_wallet_ledger').get().n,ledger);
  assert.equal(JSON.parse(store.db.prepare('SELECT receipt FROM economy_skin_gift_decisions WHERE gift_id=?').get(id).receipt).steam_id,sender.steam_id);
  assert.equal(gifts.offer(sender,input).id,id,'old offer retries cannot recreate transferred ownership');
  assert.throws(()=>gifts.decide(sender,{id,decision:'cancelled',expectedRevision:0}),{status:409});
});
test('conflicting, duplicate pending, declined, cancelled and expired offers cannot transfer',async()=>{
  const {preset,input}=await fixture(),{id}=gifts.offer(sender,input);
  assert.throws(()=>gifts.offer(sender,{...input,recipientSteamId:other.steam_id}),{status:409});
  assert.throws(()=>gifts.offer(sender,{...input,requestId:randomUUID()}),{status:409});
  gifts.decide(recipient,{id,decision:'declined',expectedRevision:0});
  assert.throws(()=>gifts.decide(recipient,{id,decision:'accepted',expectedRevision:0}),{status:409});
  const next=gifts.offer(sender,{...input,requestId:randomUUID()});gifts.decide(sender,{id:next.id,decision:'cancelled',expectedRevision:0});
  assert.equal(gifts.decide(sender,{id:next.id,decision:'cancelled',expectedRevision:0}).duplicate,true);
  const expired=gifts.offer(sender,{...input,requestId:randomUUID()});now+=7*86400000;
  assert.equal(gifts.list(recipient).gifts.find(g=>g.id===expired.id).state,'expired');
  assert.throws(()=>gifts.decide(recipient,{id:expired.id,decision:'accepted',expectedRevision:0}),{status:409});
  assert.equal(store.hasSkinUnlock(sender.steam_id,preset.id),true);
  assert.doesNotThrow(()=>gifts.offer(sender,{...input,requestId:randomUUID()}));
});
test('acceptance rechecks changed palette, receipt and recipient ownership',async()=>{
  for(const change of ['palette','receipt','recipient']){
    const {preset,input}=await fixture(),{id}=gifts.offer(sender,input);
    if(change==='palette')store.db.prepare('UPDATE economy_skin_presets SET species=? WHERE id=?').run('Carnotaurus',preset.id);
    if(change==='receipt')store.db.prepare('UPDATE economy_skin_unlocks SET idempotency_key=? WHERE preset_id=?').run(randomUUID(),preset.id);
    if(change==='recipient'){store.ensureWallet(recipient.steam_id);store.db.prepare('INSERT INTO economy_skin_unlocks(steam_id,preset_id,idempotency_key) VALUES (?,?,?)').run(recipient.steam_id,preset.id,randomUUID());}
    assert.throws(()=>gifts.decide(recipient,{id,decision:'accepted',expectedRevision:0}),{status:409});
    assert.equal(store.hasSkinUnlock(sender.steam_id,preset.id),true);
  }
});
test('transaction failure restores the original owner and leaves the offer pending',async()=>{
  const {preset,input}=await fixture(),{id}=gifts.offer(sender,input);
  store.db.exec("CREATE TRIGGER gift_fixture_fail BEFORE INSERT ON economy_skin_gift_decisions BEGIN SELECT RAISE(ABORT,'gift fixture failure'); END");
  assert.throws(()=>gifts.decide(recipient,{id,decision:'accepted',expectedRevision:0}),/gift fixture failure/);
  assert.equal(store.hasSkinUnlock(sender.steam_id,preset.id),true);assert.equal(store.hasSkinUnlock(recipient.steam_id,preset.id),false);
  assert.equal(gifts.list(sender).gifts.find(g=>g.id===id).state,'pending');store.db.exec('DROP TRIGGER gift_fixture_fail');
  gifts.decide(recipient,{id,decision:'accepted',expectedRevision:0});
});
test('gifting rejects borrowed, free, creator-owned and membership skins and disabled writes',async()=>{
  const {preset,input}=await fixture();
  assert.throws(()=>gifts.offer(creator,input),{status:409});
  skins.publishPreset({presetId:preset.id,price:0});assert.throws(()=>gifts.offer(sender,input),{status:409});
  skins.publishPreset({presetId:preset.id,price:100});
  store.grantSkinPreset({steamId:sender.steam_id,presetId:preset.id,grantedBySteamId:creator.steam_id,note:'Borrowed access'});
  assert.throws(()=>gifts.offer(sender,input),{status:409});
  const premium=require('../src/services/premiumSkinService').seedDrafts({ownerSteamId:creator.steam_id}).skins[0];
  assert.throws(()=>gifts.offer(sender,{...input,presetId:premium.presetId}),{status:409});
  on=false;assert.throws(()=>gifts.offer(sender,input),{status:503});assert.throws(()=>gifts.decide(recipient,{id:'none',decision:'accepted',expectedRevision:0}),{status:503});on=true;
});

test('a promotional redemption receipt cannot regrant a skin after gifting',async()=>{
  const {preset}=await fixture();
  store.db.prepare('DELETE FROM economy_skin_unlocks WHERE steam_id=? AND preset_id=?').run(sender.steam_id,preset.id);
  const promo=require('../src/services/skinPromoService').createSkinPromoService(store,{now:()=>now,enabled:()=>true});
  const code='HVP-'+require('node:crypto').randomBytes(32).toString('hex');
  promo.issue({...creator,is_admin:true},{presetId:preset.id,code,reason:'Approved event reward',expiresAt:now+86400000,requestId:randomUUID()});
  promo.redeem(sender,{code});
  const {id}=gifts.offer(sender,{presetId:preset.id,recipientSteamId:recipient.steam_id,requestId:randomUUID()});
  gifts.decide(recipient,{id,decision:'accepted',expectedRevision:0});
  const retry=promo.redeem(sender,{code});assert.equal(retry.duplicate,true);assert.equal(retry.stillOwned,false);
  assert.equal(store.hasSkinUnlock(sender.steam_id,preset.id),false);assert.equal(store.hasSkinUnlock(recipient.steam_id,preset.id),true);
});
