'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{Worker}=require('node:worker_threads'),{randomUUID}=require('node:crypto');
const workerSource=`const {parentPort,workerData:d}=require('node:worker_threads');process.env.AUTOMATION_DB_PATH=d.database;
const store=require(d.storePath),service=d.moderationPath?require(d.moderationPath).createSkinMarketModeration(store,{enabled:()=>true,readOnly:()=>false}):require(d.servicePath).createSkinTradingService(store,{enabled:()=>true});
parentPort.once('message',()=>{try{parentPort.postMessage({result:service[d.action](d.user,d.input)});}catch(e){parentPort.postMessage({error:e.message,status:e.status});}finally{store.db.close();}});parentPort.postMessage({ready:true});`;
async function worker(data){
 const instance=new Worker(workerSource,{eval:true,workerData:data});let readyResolve,readyReject,resultResolve,resultReject;
 const ready=new Promise((a,b)=>{readyResolve=a;readyReject=b;}),result=new Promise((a,b)=>{resultResolve=a;resultReject=b;});result.catch(()=>{});
 instance.on('message',value=>value.ready?readyResolve():resultResolve(value));instance.on('error',error=>{readyReject(error);resultReject(error);});const exit=new Promise(resolve=>instance.once('exit',resolve));
 await ready;return {start:()=>instance.postMessage('go'),result,exit,stop:()=>instance.terminate()};
}
test('independent trading workers serialize competing buyers, exact retries and cancellation',{timeout:30000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hv-skin-trade-race-')),database=path.join(dir,'economy.sqlite'),children=[];
 process.env.AUTOMATION_DB_PATH=database;process.env.SKIN_SYSTEM_ENABLED='true';process.env.SKIN_PRESET_CREATE_COST='0';
 const storagePath=require.resolve('../src/services/dinoStorageService');require.cache[storagePath]={id:storagePath,filename:storagePath,loaded:true,exports:{}};
 const storePath=require.resolve('../src/services/economyStore'),servicePath=require.resolve('../src/services/skinTradingService'),store=require(storePath),skins=require('../src/services/skinPresetService'),service=require(servicePath).createSkinTradingService(store,{enabled:()=>true});
 const creator={steam_id:'76561198000000500'},seller={steam_id:'76561198000000501'},a={steam_id:'76561198000000502'},b={steam_id:'76561198000000503'};
 const fund=(user,amount)=>store.applyWalletTransaction({steamId:user.steam_id,amount,kind:'fixture',reason:'Synthetic trading funds',idempotencyKey:randomUUID()});
 fund(a,1000);fund(b,1000);
 async function fixture(){
  const skin=Object.fromEntries(skins.COLOR_KEYS.map(k=>[k,{r:.1,g:.2,b:.3,a:1}]));Object.assign(skin,{skinVariation:1,patternIndex:2,themeIndex:3});
  const {preset}=await skins.createPresetFromStudio({steamId:creator.steam_id,name:'Trade race',species:'Triceratops',skin,idempotencyKey:randomUUID()});skins.publishPreset({presetId:preset.id,price:100});fund(seller,100);skins.purchasePreset({steamId:seller.steam_id,presetId:preset.id,idempotencyKey:randomUUID()});
  return {preset,id:service.offer(seller,{presetId:preset.id,price:200,requestId:randomUUID()}).listing.id};
 }
 async function race(actions){const racers=await Promise.all(actions.map(async([action,user,input])=>{const child=await worker({database,storePath,servicePath,moderationPath:action==='change'?require.resolve('../src/services/skinMarketModeration'):null,action,user,input});children.push(child);return child;}));racers.forEach(child=>child.start());const results=await Promise.all(racers.map(child=>child.result));await Promise.all(racers.map(child=>child.exit));return results;}
 const buy=id=>({id,expectedRevision:0,expectedPrice:200,requestId:randomUUID()});
 try{
  const first=await fixture(),outcomes=await race([['buy',a,buy(first.id)],['buy',b,buy(first.id)]]);
  assert.equal(outcomes.filter(row=>row.result).length,1);assert.equal(outcomes.filter(row=>row.status===409).length,1);
  const trade=store.db.prepare('SELECT * FROM economy_skin_trades WHERE listing_id=?').get(first.id);assert.ok([a.steam_id,b.steam_id].includes(trade.buyer));assert.equal(store.getWallet(seller.steam_id).balance,200);
  assert.equal(store.getWallet(a.steam_id).balance+store.getWallet(b.steam_id).balance,1800);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM economy_skin_unlocks WHERE preset_id=?').get(first.preset.id).n,1);
  const second=await fixture(),request=buy(second.id),retries=await race([['buy',a,request],['buy',a,request]]);assert.deepEqual(retries.map(row=>row.result.duplicate).sort(),[false,true]);
  const recovered=await race([['buy',a,request]]);assert.equal(recovered[0].result.duplicate,true);
  const third=await fixture(),before=store.getWallet(b.steam_id).balance,decision=await race([['buy',b,buy(third.id)],['cancel',seller,{id:third.id,expectedRevision:0}]]);
  assert.equal(decision.filter(row=>row.result).length,1);assert.equal(decision.filter(row=>row.status===409).length,1);
  const sold=store.db.prepare('SELECT state FROM economy_skin_listings WHERE id=?').get(third.id).state==='sold';assert.equal(store.hasSkinUnlock(b.steam_id,third.preset.id),sold);assert.equal(store.hasSkinUnlock(seller.steam_id,third.preset.id),!sold);assert.equal(store.getWallet(b.steam_id).balance,before-(sold?200:0));
  const staff={steam_id:'76561198000000504'},fourth=await fixture(),fourthRequest=buy(fourth.id),beforeHold=store.getWallet(b.steam_id).balance;
  const held=await race([['buy',b,fourthRequest],['change',staff,{action:'hold',target:fourth.preset.id,active:true,expectedRevision:0,requestId:randomUUID(),reason:'Reviewed resale hold racing with settlement'}]]);
  assert.ok(held[1].result);const paid=Boolean(held[0].result);assert.ok(paid||held[0].status===409);assert.equal(store.getWallet(b.steam_id).balance,beforeHold-(paid?200:0));assert.equal(store.hasSkinUnlock(b.steam_id,fourth.preset.id),paid);
  if(paid)assert.equal(service.buy(b,fourthRequest).duplicate,true);else assert.throws(()=>service.buy(b,fourthRequest),{status:409});
  const fifth=await fixture(),beforeWithdraw=store.getWallet(b.steam_id).balance;
  const withdrawn=await race([['buy',b,buy(fifth.id)],['change',staff,{action:'withdraw',target:fifth.id,expectedRevision:0,requestId:randomUUID(),reason:'Reviewed listing withdrawal racing with settlement'}]]);
  assert.equal(withdrawn.filter(row=>row.result).length,1);assert.equal(withdrawn.filter(row=>row.status===409).length,1);const bought=Boolean(withdrawn[0].result);assert.equal(store.getWallet(b.steam_id).balance,beforeWithdraw-(bought?200:0));assert.equal(store.hasSkinUnlock(b.steam_id,fifth.preset.id),bought);
  for(const {id}of[first,second,third,fourth,fifth]){const ledger=store.db.prepare("SELECT COUNT(*) n,COALESCE(SUM(amount),0) net FROM economy_wallet_ledger WHERE reference_type='skin_trade' AND reference_id=?").get(id);assert.equal(ledger.net,0);assert.ok([0,2].includes(ledger.n));}
 }finally{await Promise.all(children.map(child=>child.stop()));store.db.close();const target=path.resolve(dir);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('hv-skin-trade-race-'));fs.rmSync(target,{recursive:true,force:true});}
});
