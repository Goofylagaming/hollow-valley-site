'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
process.env.AUTOMATION_DB_PATH=':memory:';process.env.SKIN_SYSTEM_ENABLED='true';process.env.SKIN_PRESET_CREATE_COST='0';
const storagePath=require.resolve('../src/services/dinoStorageService');require.cache[storagePath]={id:storagePath,filename:storagePath,loaded:true,exports:{}};
const store=require('../src/services/economyStore'),skins=require('../src/services/skinPresetService'),{createSkinTradingService}=require('../src/services/skinTradingService'),{createSkinMarketModeration}=require('../src/services/skinMarketModeration');
test.after(()=>store.db.close());let serial=400000;
async function fixture(){
 const user=()=>({steam_id:'76561198000'+String(serial++).padStart(6,'0')}),creator=user(),seller=user(),buyer=user(),staff=user(),other=user();let clock=Date.parse('2026-11-06T00:00:00Z'),on=true,preview=false;
 const market=createSkinTradingService(store,{now:()=>clock,enabled:()=>true}),moderation=createSkinMarketModeration(store,{now:()=>clock,enabled:()=>on,readOnly:()=>preview});
 const skin=Object.fromEntries(skins.COLOR_KEYS.map(key=>[key,{r:.2,g:.3,b:.4,a:1}]));Object.assign(skin,{skinVariation:1,patternIndex:2,themeIndex:3});
 const {preset}=await skins.createPresetFromStudio({steamId:creator.steam_id,name:'Moderation <fixture>',species:'Triceratops',skin,idempotencyKey:randomUUID()});skins.publishPreset({presetId:preset.id,price:100});
 for(const who of[seller,buyer])store.applyWalletTransaction({steamId:who.steam_id,amount:500,kind:'fixture',reason:'Synthetic moderation funds',idempotencyKey:randomUUID()});skins.purchasePreset({steamId:seller.steam_id,presetId:preset.id,idempotencyKey:randomUUID()});
 const id=market.offer(seller,{presetId:preset.id,price:200,requestId:randomUUID()}).listing.id;
 return {market,moderation,creator,seller,buyer,staff,other,preset,id,buy:{id,expectedRevision:0,expectedPrice:200,requestId:randomUUID()},withdraw:{action:'withdraw',target:id,expectedRevision:0,reason:'PRIVATE staff review of a reported listing',requestId:randomUUID()},hold:{action:'hold',target:preset.id,active:true,expectedRevision:0,reason:'PRIVATE review of resale eligibility',requestId:randomUUID()},pause:()=>{on=false;},preview:value=>{preview=value;},advance:value=>{clock+=value;}};
}
test('reviewed withdrawal closes only an unsold listing, retains ownership and recovers the same immutable receipt',async()=>{
 const f=await fixture(),before=store.db.prepare('SELECT COUNT(*) n FROM economy_wallet_ledger').get().n;
 const first=f.moderation.change(f.staff,f.withdraw);assert.equal(first.receipt.state,'withdrawn');assert.equal(f.moderation.change(f.staff,f.withdraw).duplicate,true);assert.deepEqual(f.moderation.receipt(f.staff,{requestId:f.withdraw.requestId}).receipt,first.receipt);
 assert.throws(()=>f.moderation.receipt(f.other,{requestId:f.withdraw.requestId}),{status:404});assert.throws(()=>f.moderation.change(f.staff,{...f.withdraw,reason:'A different private review reason'}),{status:409});assert.throws(()=>f.market.buy(f.buyer,f.buy),{status:409});
 assert.equal(store.getWallet(f.buyer.steam_id).balance,500);assert.equal(store.getWallet(f.seller.steam_id).balance,400);assert.ok(store.hasSkinUnlock(f.seller.steam_id,f.preset.id));assert.equal(store.db.prepare('SELECT COUNT(*) n FROM economy_wallet_ledger').get().n,before);
 const detail=f.moderation.read(f.staff,{id:f.id});assert.equal(detail.listingHistory.length,1);assert.equal(detail.listingHistory[0].reason,f.withdraw.reason);assert.equal(detail.trade,null);
 assert.doesNotMatch(JSON.stringify(f.market.list(f.seller,{own:true})),/PRIVATE|reviewer|reason/);
});
test('resale holds block new listings and settlement, survive management pause, and clear only with the reviewed revision',async()=>{
 const f=await fixture(),first=f.moderation.change(f.staff,f.hold);assert.equal(first.receipt.active,true);assert.equal(f.moderation.read(f.staff,{id:f.id}).hold.revision,1);
 assert.throws(()=>f.market.buy(f.buyer,f.buy),{status:409});assert.throws(()=>f.market.offer(f.seller,{presetId:f.preset.id,price:200,requestId:randomUUID()}),{status:409});assert.equal(f.market.list(f.buyer).listings.find(row=>row.id===f.id).held,true);assert.equal(f.market.eligible(f.seller).skins.some(row=>row.id===f.preset.id),false);
 assert.throws(()=>f.moderation.change(f.staff,{...f.hold,requestId:randomUUID(),active:false}),{status:409});
 f.market.cancel(f.seller,{id:f.id,expectedRevision:0});assert.ok(store.hasSkinUnlock(f.seller.steam_id,f.preset.id));
 const clear={...f.hold,active:false,expectedRevision:1,requestId:randomUUID(),reason:'Reviewed hold release after checking the report'};f.moderation.change(f.staff,clear);assert.equal(f.moderation.change(f.staff,clear).duplicate,true);
 const next=f.market.offer(f.seller,{presetId:f.preset.id,price:200,requestId:randomUUID()}).listing.id;
 f.moderation.change(f.staff,{...f.hold,expectedRevision:2,requestId:randomUUID()});f.pause();assert.throws(()=>f.moderation.read(f.staff,{id:next}),{status:503});assert.throws(()=>f.market.buy(f.buyer,{...f.buy,id:next}),{status:409});
});
test('failed audit insertion rolls back withdrawal and hold state together',async()=>{
 const f=await fixture();store.db.exec("CREATE TRIGGER reject_market_review BEFORE INSERT ON economy_skin_market_reviews BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END");
 try{assert.throws(()=>f.moderation.change(f.staff,f.withdraw),/synthetic audit failure/);assert.equal(f.market.ownListing(f.seller,{id:f.id}).listing.state,'active');assert.throws(()=>f.moderation.change(f.staff,f.hold),/synthetic audit failure/);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM economy_skin_market_holds WHERE preset_id=?').get(f.preset.id).n,0);}
 finally{store.db.exec('DROP TRIGGER reject_market_review');}
 assert.equal(f.market.buy(f.buyer,f.buy).duplicate,false);assert.throws(()=>f.moderation.change(f.staff,f.withdraw),{status:409});
});
test('preview blocks changes while exact support reads remain query-only',async()=>{
 const f=await fixture();f.moderation.change(f.staff,f.hold);f.preview(true);assert.throws(()=>f.moderation.change(f.staff,f.withdraw),{status:403});
 const before=store.db.prepare('SELECT total_changes() n').get().n;store.db.exec('PRAGMA query_only=ON');
 try{assert.equal(f.moderation.read(f.staff,{id:f.id}).hold.active,true);assert.equal(f.moderation.receipt(f.staff,{requestId:f.hold.requestId}).receipt.active,true);assert.equal(store.db.prepare('SELECT total_changes() n').get().n,before);}
 finally{store.db.exec('PRAGMA query_only=OFF');}
 assert.throws(()=>createSkinMarketModeration(store,{enabled:()=>false,initialize:true}),{status:503});assert.throws(()=>createSkinMarketModeration(store,{enabled:()=>true,readOnly:()=>true,initialize:true}),{status:503});
});
test('missing, mismatched or rolled-back hold audit fails closed without relabeling it as an unheld skin',async()=>{
 const f=await fixture();f.moderation.change(f.staff,f.hold);const initial={...store.db.prepare('SELECT * FROM economy_skin_market_holds WHERE preset_id=?').get(f.preset.id)};
 f.moderation.change(f.staff,{...f.hold,active:false,expectedRevision:1,requestId:randomUUID(),reason:'Reviewed release of the prior resale hold'});
 store.db.prepare('UPDATE economy_skin_market_holds SET active=?,revision=?,operation_id=?,at=? WHERE preset_id=?').run(initial.active,initial.revision,initial.operation_id,initial.at,f.preset.id);
 assert.throws(()=>f.market.buy(f.buyer,f.buy),{status:503});store.db.prepare('DELETE FROM economy_skin_market_holds WHERE preset_id=?').run(f.preset.id);assert.throws(()=>f.market.buy(f.buyer,f.buy),{status:503});
 assert.equal(store.getWallet(f.buyer.steam_id).balance,500);assert.ok(store.hasSkinUnlock(f.seller.steam_id,f.preset.id));
});
test('review clocks cannot move backward and support views do not expose raw unlock or ledger payloads',async()=>{
 const f=await fixture();f.moderation.change(f.staff,f.hold);f.advance(-1);assert.throws(()=>f.moderation.change(f.staff,{...f.hold,active:false,expectedRevision:1,requestId:randomUUID()}),{status:503});
 assert.throws(()=>f.market.buy(f.buyer,f.buy),{status:503});f.advance(1);assert.doesNotMatch(JSON.stringify(f.moderation.read(f.staff,{id:f.id})),/unlock_key|unlock_receipt|fingerprint|skin_json|idempotency_key/);
 const g=await fixture();g.advance(-1);assert.throws(()=>g.moderation.change(g.staff,g.withdraw),{status:503});assert.throws(()=>g.market.buy(g.buyer,g.buy),{status:503});assert.throws(()=>g.market.cancel(g.seller,{id:g.id,expectedRevision:0}),{status:503});
});

test('a release whose stored request contradicts its receipt cannot authorize a sale or a receipt retry',async()=>{
 const f=await fixture();f.moderation.change(f.staff,f.hold);const clear={...f.hold,active:false,expectedRevision:1,requestId:randomUUID(),reason:'Reviewed release after checking current evidence'};const saved=f.moderation.change(f.staff,clear);
 const row=store.db.prepare('SELECT payload_json FROM economy_skin_market_reviews WHERE id=?').get(saved.receipt.id),payload=JSON.parse(row.payload_json);payload.active=true;store.db.prepare('UPDATE economy_skin_market_reviews SET payload_json=? WHERE id=?').run(JSON.stringify(payload),saved.receipt.id);
 assert.throws(()=>f.market.buy(f.buyer,f.buy),{status:503});assert.throws(()=>f.moderation.receipt(f.staff,{requestId:clear.requestId}),{status:503});assert.equal(store.getWallet(f.buyer.steam_id).balance,500);
});
