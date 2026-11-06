'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),{DatabaseSync}=require('node:sqlite'),{randomUUID}=require('node:crypto');
process.env.AUTOMATION_DB_PATH=':memory:';process.env.SKIN_SYSTEM_ENABLED='true';process.env.SKIN_PRESET_CREATE_COST='0';process.env.HOLLOW_VALLEY_API_TOKEN='synthetic-trading-test-token';
const storagePath=require.resolve('../automation-platform/src/services/dinoStorageService');require.cache[storagePath]={id:storagePath,filename:storagePath,loaded:true,exports:{}};
const store=require('../automation-platform/src/services/economyStore'),skins=require('../automation-platform/src/services/skinPresetService'),client=require('../server/services/skinTradingClient');
const {createSkinTradingService}=require('../automation-platform/src/services/skinTradingService'),{createSkinTradingRouter:sourceRouter}=require('../automation-platform/src/routes/skinTradingRoutes'),{createSkinTradingRouter:websiteRouter}=require('../server/routes/skinTrading');
const listen=app=>new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
test('real website/source trading APIs bind actors, protect current accounts and retain private paused recovery',async t=>{
 const db=new DatabaseSync(':memory:'),seller='76561198000000901',buyer='76561198000000902',creator='76561198000000903';let enabled=true,preview=false,sourcePreview=false,after=null,calls=0;
 db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY,steam_id TEXT)');db.prepare('INSERT INTO users VALUES(1,?),(2,?)').run(seller,buyer);
 const service=createSkinTradingService(store,{enabled:()=>enabled});
 const source=express();source.use(express.json());source.use('/api/website/skin-trading',sourceRouter({getService:()=>service,readOnly:()=>sourcePreview}));
 const remote=await listen(source);process.env.AUTOMATION_SERVICE_URL='http://127.0.0.1:'+remote.address().port;
 const app=express();app.use(express.json());app.use((req,_res,next)=>{if(req.get('x-fixture-user'))req.user=db.prepare('SELECT * FROM users WHERE id=?').get(Number(req.get('x-fixture-user')));next();});
 app.use('/api/skins/trading',websiteRouter({db,enabled:()=>enabled,readOnly:()=>preview,client:{call:async(...args)=>{calls++;const value=await client.call(...args);after?.();return value;}}}));
 const server=await listen(app),origin='http://127.0.0.1:'+server.address().port;
 const send=(action,body={},user=1,headers={})=>fetch(origin+'/api/skins/trading/'+action,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,'x-fixture-user':String(user),'X-Skin-Trader':user+':'+(user===1?seller:buyer),...headers},body:JSON.stringify(body)});
 const skin=Object.fromEntries(skins.COLOR_KEYS.map(key=>[key,{r:.2,g:.3,b:.4,a:1}]));Object.assign(skin,{skinVariation:1,patternIndex:2,themeIndex:3});
 try{
  const {preset}=await skins.createPresetFromStudio({steamId:creator,name:'HTTP <trade>',species:'Triceratops',skin,idempotencyKey:randomUUID()});skins.publishPreset({presetId:preset.id,price:100});
  for(const steamId of[seller,buyer])store.applyWalletTransaction({steamId,amount:500,kind:'fixture',reason:'Synthetic trading funds',idempotencyKey:randomUUID()});skins.purchasePreset({steamId:seller,presetId:preset.id,idempotencyKey:randomUUID()});
  assert.equal((await fetch(origin+'/api/skins/trading/capabilities')).status,401);
  const caps=await fetch(origin+'/api/skins/trading/capabilities',{headers:{'x-fixture-user':'1'}});assert.equal(caps.headers.get('cache-control'),'private, no-store');assert.equal((await caps.json()).traderBinding,'1:'+seller);
  for(const headers of[{Origin:'https://foreign.invalid'},{Origin:''},{'X-Skin-Trader':'2:'+buyer}])assert.equal((await send('offer',{},1,headers)).status,403);
  const noCalls=calls;assert.equal((await send('list',{steamId:buyer})).status,400);assert.equal((await send('list?steamId='+buyer)).status,400);assert.equal(calls,noCalls);
  const raw=await fetch(process.env.AUTOMATION_SERVICE_URL+'/api/website/skin-trading/list',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({steamId:seller,own:true})});assert.equal(raw.status,401);
  const eligible=await(await send('eligible')).json();assert.equal(eligible.skins[0].id,preset.id);
  const input={presetId:preset.id,price:200,requestId:randomUUID()},listed=await(await send('offer',input)).json();assert.equal(listed.listing.state,'active');
  const recovered=await(await send('offerReceipt',{requestId:input.requestId})).json();assert.equal(recovered.listing.id,listed.listing.id);assert.equal((await send('offerReceipt',{requestId:input.requestId},2)).status,404);
  const listing=await(await send('list',{},2)).json();assert.equal(listing.listings[0].mine,false);assert.doesNotMatch(JSON.stringify(listing.listings),new RegExp(seller+'|unlock_key|fingerprint'));
  for(const limit of [0,51,'12'])assert.equal((await send('list',{limit},2)).status,400);assert.equal((await send('list',{limit:6},2)).status,200);
  preview=true;assert.equal((await send('cancel',{id:listed.listing.id,expectedRevision:0})).status,403);assert.equal((await send('list',{own:true})).status,200);preview=false;
  sourcePreview=true;assert.equal((await send('buy',{id:listed.listing.id,expectedRevision:0,expectedPrice:200,requestId:randomUUID()},2)).status,403);sourcePreview=false;
  const request={id:listed.listing.id,expectedRevision:0,expectedPrice:200,requestId:randomUUID()};assert.equal((await send('buy',request,2)).status,200);
  const history=await(await send('history',{},2)).json();assert.equal(history.trades[0].role,'buyer');assert.equal(history.trades[0].price,200);assert.doesNotMatch(JSON.stringify(history.trades),new RegExp(seller+'|'+buyer+'|unlock_receipt|request_id'));
  assert.equal((await(await send('history')).json()).trades[0].role,'seller');
  enabled=false;assert.equal((await send('offer',input)).status,503);assert.equal((await send('list')).status,503);assert.equal((await send('history',{},2)).status,200);assert.equal((await send('receipt',{requestId:request.requestId},2)).status,200);assert.equal((await send('list',{own:true})).status,200);enabled=true;
  after=()=>db.prepare('UPDATE users SET steam_id=? WHERE id=2').run(creator);assert.equal((await send('history',{},2)).status,403);after=null;db.prepare('UPDATE users SET steam_id=? WHERE id=2').run(buyer);
  after=()=>{enabled=false;};assert.equal((await send('eligible')).status,503);after=null;
  await t.test('paused/preview source reads never initialize trading schema and existing recovery succeeds query-only',async()=>{
   const empty=new DatabaseSync(':memory:');empty.exec('PRAGMA query_only=ON');let selected={db:empty};
   const readApp=express();readApp.use(express.json());readApp.use('/trading',sourceRouter({getStore:()=>selected,enabled:()=>false,readOnly:()=>true}));const readServer=await listen(readApp),readUrl='http://127.0.0.1:'+readServer.address().port;
   const read=action=>fetch(readUrl+'/trading/'+action,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.HOLLOW_VALLEY_API_TOKEN},body:JSON.stringify({steamId:buyer,...(action==='list'?{own:true}:{})})});
   try{assert.equal((await read('history')).status,503);assert.equal(empty.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get().n,0);
    selected=store;const changes=store.db.prepare('SELECT total_changes() n').get().n;store.db.exec('PRAGMA query_only=ON');
    assert.equal((await read('history')).status,200);assert.equal((await read('list')).status,200);assert.equal(store.db.prepare('SELECT total_changes() n').get().n,changes);
   }finally{store.db.exec('PRAGMA query_only=OFF');await new Promise(resolve=>readServer.close(resolve));empty.close();}
  });
 }finally{await Promise.all([server,remote].map(s=>new Promise(resolve=>s.close(resolve))));db.close();store.db.close();}
});
