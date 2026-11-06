'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
process.env.AUTOMATION_DB_PATH=':memory:';process.env.SKIN_SYSTEM_ENABLED='true';process.env.SKIN_PRESET_CREATE_COST='0';
const storagePath=require.resolve('../src/services/dinoStorageService');require.cache[storagePath]={id:storagePath,filename:storagePath,loaded:true,exports:{}};
const store=require('../src/services/economyStore'),skins=require('../src/services/skinPresetService');
const {createSkinTradingService}=require('../src/services/skinTradingService'),{createSkinGiftService}=require('../src/services/skinGiftService');
test.after(()=>store.db.close());let serial=1000;
async function fixture(){
 const user=()=>({steam_id:'76561198000'+String(serial++).padStart(6,'0')}),creator=user(),seller=user(),buyer=user(),other=user();let at=Date.parse('2026-11-06T00:00:00Z'),enabled=true;
 const service=createSkinTradingService(store,{now:()=>at,enabled:()=>enabled}),gifts=createSkinGiftService(store,{now:()=>at,enabled:()=>true});
 const skin=Object.fromEntries(skins.COLOR_KEYS.map(k=>[k,{r:.2,g:.3,b:.4,a:1}]));Object.assign(skin,{skinVariation:1,patternIndex:2,themeIndex:3});
 const preset=(await skins.createPresetFromStudio({steamId:creator.steam_id,species:'Triceratops',name:'Trade <fixture>',skin,idempotencyKey:randomUUID()})).preset;
 skins.publishPreset({presetId:preset.id,price:100});
 const fund=(who,amount)=>store.applyWalletTransaction({steamId:who.steam_id,amount,kind:'fixture',reason:'Synthetic trade funds',idempotencyKey:randomUUID()});
 fund(seller,100);fund(buyer,500);skins.purchasePreset({steamId:seller.steam_id,presetId:preset.id,idempotencyKey:randomUUID()});
 const offer={presetId:preset.id,price:200,requestId:randomUUID()},buy=id=>({id,expectedRevision:0,expectedPrice:200,requestId:randomUUID()});
 return {creator,seller,buyer,other,preset,service,gifts,offer,buy,fund,advance:ms=>{at+=ms;},pause:()=>{enabled=false;}};
}
const balance=user=>store.getWallet(user.steam_id).balance;
test('sale atomically moves the existing unlock and a zero-sum pair of wallet entries; retries recover one receipt',async()=>{
 const f=await fixture(),{service,seller,buyer,preset}=f;
 const original=store.db.prepare('SELECT * FROM economy_skin_unlocks WHERE steam_id=? AND preset_id=?').get(seller.steam_id,preset.id);
 const offer=service.offer(seller,f.offer);assert.equal(service.offer(seller,f.offer).duplicate,true);assert.equal(balance(seller),0);assert.equal(balance(buyer),500);assert.ok(store.hasSkinUnlock(seller.steam_id,preset.id));
 const request=f.buy(offer.listing.id);assert.equal(service.buy(buyer,request).duplicate,false);assert.equal(service.buy(buyer,request).duplicate,true);
 assert.equal(balance(seller),200);assert.equal(balance(buyer),300);
 const unlocks=store.db.prepare('SELECT * FROM economy_skin_unlocks WHERE preset_id=?').all(preset.id);assert.equal(unlocks.length,1);assert.deepEqual({...unlocks[0],steam_id:seller.steam_id},{...original});assert.equal(unlocks[0].steam_id,buyer.steam_id);
 const entries=store.db.prepare("SELECT amount FROM economy_wallet_ledger WHERE reference_type='skin_trade' AND reference_id=?").all(offer.listing.id);assert.equal(entries.length,2);assert.equal(entries.reduce((sum,row)=>sum+row.amount,0),0);
 assert.equal(service.list(seller,{own:true}).listings[0].state,'sold');assert.equal(service.receipt(buyer,{requestId:request.requestId}).id,request.id);
 assert.throws(()=>service.receipt(f.other,{requestId:request.requestId}),{status:404});assert.throws(()=>service.buy(buyer,{...request,expectedPrice:201}),{status:409});
 f.pause();assert.equal(service.receipt(buyer,{requestId:request.requestId}).price,200);
});
test('quotes, account ownership, balances and eligibility are rechecked before any purchase',async()=>{
 const f=await fixture(),id=f.service.offer(f.seller,f.offer).listing.id,request=f.buy(id);
 assert.throws(()=>f.service.offer(f.seller,{...f.offer,price:201}),{status:409});assert.throws(()=>f.service.offer(f.seller,{...f.offer,requestId:randomUUID()}),{status:409});
 assert.throws(()=>f.service.buy(f.seller,request),{status:409});assert.throws(()=>f.service.buy(f.creator,request),{status:409});assert.throws(()=>f.service.buy(f.buyer,{...request,expectedPrice:199}),{status:409});
 assert.throws(()=>f.service.buy(f.other,request),{status:409});assert.equal(balance(f.buyer),500);assert.equal(balance(f.seller),0);
 assert.equal(store.db.prepare('SELECT COUNT(*) n FROM economy_skin_trades WHERE listing_id=?').get(id).n,0);
 const before=JSON.stringify(store.db.prepare('SELECT * FROM economy_skin_presets WHERE id=?').get(f.preset.id));
 store.db.prepare("UPDATE economy_skin_presets SET skin_json='{}' WHERE id=?").run(f.preset.id);
 assert.throws(()=>f.service.buy(f.buyer,request),{status:409});assert.equal(balance(f.buyer),500);assert.ok(before);
});
test('a failure after wallet and unlock writes rolls back the whole sale',async()=>{
 const f=await fixture(),id=f.service.offer(f.seller,f.offer).listing.id,request=f.buy(id);
 store.db.exec("CREATE TRIGGER reject_trade BEFORE INSERT ON economy_skin_trades BEGIN SELECT RAISE(ABORT,'synthetic receipt failure'); END");
 try{assert.throws(()=>f.service.buy(f.buyer,request),/synthetic receipt failure/);assert.equal(balance(f.buyer),500);assert.equal(balance(f.seller),0);assert.ok(store.hasSkinUnlock(f.seller.steam_id,f.preset.id));assert.equal(store.db.prepare("SELECT COUNT(*) n FROM economy_wallet_ledger WHERE reference_id=?").get(id).n,0);assert.equal(f.service.list(f.seller,{own:true}).listings[0].state,'active');}
 finally{store.db.exec('DROP TRIGGER reject_trade');}
 assert.equal(f.service.buy(f.buyer,request).duplicate,false);
});
test('gifts and pending live/parked application holds prevent stale-listing settlement',async()=>{
 const f=await fixture(),id=f.service.offer(f.seller,f.offer).listing.id,request=f.buy(id);
 const gift=f.gifts.offer(f.seller,{recipientSteamId:f.other.steam_id,presetId:f.preset.id,requestId:randomUUID()});assert.throws(()=>f.service.buy(f.buyer,request),{status:409});
 f.gifts.decide(f.other,{id:gift.id,decision:'accepted',expectedRevision:0});assert.throws(()=>f.service.buy(f.buyer,request),{status:409});assert.equal(balance(f.buyer),500);assert.equal(balance(f.seller),0);
 const g=await fixture(),otherId=g.service.offer(g.seller,g.offer).listing.id;
 store.db.prepare('INSERT INTO economy_skin_apply_jobs(id,steam_id,preset_id,species,skin_json) VALUES(?,?,?,?,?)').run(randomUUID(),g.seller.steam_id,g.preset.id,'Triceratops','{}');
 assert.throws(()=>g.service.buy(g.buyer,g.buy(otherId)),{status:409});
 store.db.prepare("UPDATE economy_skin_apply_jobs SET status='confirmed' WHERE steam_id=?").run(g.seller.steam_id);
 store.db.prepare('INSERT INTO economy_skin_parked_applications(id,steam_id,preset_id,slot,command_json,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),g.seller.steam_id,g.preset.id,'fixture','{}',1);
 assert.throws(()=>g.service.buy(g.buyer,g.buy(otherId)),{status:409});assert.equal(balance(g.buyer),500);
});
test('expiry and paused-market cancellation never move ownership or coins; projections omit private counterparts and receipts',async()=>{
 const f=await fixture(),id=f.service.offer(f.seller,f.offer).listing.id;
 const view=f.service.list(f.buyer);assert.ok(view.listings.some(row=>row.id===id));assert.doesNotMatch(JSON.stringify(view),new RegExp([f.seller.steam_id,'unlock_key','fingerprint','request_id'].join('|')));
 f.advance(7*86400000);assert.throws(()=>f.service.buy(f.buyer,f.buy(id)),{status:409});assert.equal(f.service.list(f.seller,{own:true}).listings[0].state,'expired');
 f.pause();assert.throws(()=>f.service.offer(f.seller,{...f.offer,requestId:randomUUID()}),{status:503});assert.equal(f.service.cancel(f.seller,{id,expectedRevision:0}).duplicate,false);assert.equal(f.service.cancel(f.seller,{id,expectedRevision:0}).duplicate,true);
 assert.throws(()=>f.service.cancel(f.other,{id,expectedRevision:0}),{status:404});assert.ok(store.hasSkinUnlock(f.seller.steam_id,f.preset.id));assert.equal(balance(f.buyer),500);
});
test('wallet drift and unsafe destination balances block settlement rather than create coins',async()=>{
 const f=await fixture(),id=f.service.offer(f.seller,f.offer).listing.id;
 store.db.prepare('UPDATE economy_wallets SET balance=balance+1 WHERE steam_id=?').run(f.buyer.steam_id);
 assert.throws(()=>f.service.buy(f.buyer,f.buy(id)),{status:500});assert.equal(balance(f.seller),0);assert.ok(store.hasSkinUnlock(f.seller.steam_id,f.preset.id));
 const g=await fixture(),otherId=g.service.offer(g.seller,g.offer).listing.id;g.fund(g.seller,Number.MAX_SAFE_INTEGER);
 assert.throws(()=>g.service.buy(g.buyer,g.buy(otherId)),{status:409});assert.equal(balance(g.seller),Number.MAX_SAFE_INTEGER);assert.equal(balance(g.buyer),500);
 for(const value of [0,-1,.5,'200',Number.MAX_SAFE_INTEGER+1])assert.throws(()=>f.service.offer(f.seller,{...f.offer,price:value,requestId:randomUUID()}),{status:400});
});
