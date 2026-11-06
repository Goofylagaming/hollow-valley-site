'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),{DatabaseSync}=require('node:sqlite'),{randomUUID}=require('node:crypto');
process.env.AUTOMATION_DB_PATH=':memory:';process.env.SKIN_SYSTEM_ENABLED='true';process.env.SKIN_PRESET_CREATE_COST='0';process.env.HOLLOW_VALLEY_API_TOKEN='synthetic-player-token';process.env.AUTOMATION_ADMIN_TOKEN='synthetic-separate-admin-token';
const storagePath=require.resolve('../automation-platform/src/services/dinoStorageService');require.cache[storagePath]={id:storagePath,filename:storagePath,loaded:true,exports:{}};
const store=require('../automation-platform/src/services/economyStore'),skins=require('../automation-platform/src/services/skinPresetService'),client=require('../server/services/skinTradingClient'),{createSkinTradingService}=require('../automation-platform/src/services/skinTradingService'),{createSkinMarketModeration}=require('../automation-platform/src/services/skinMarketModeration'),{createSkinMarketModerationRouter:sourceRouter}=require('../automation-platform/src/routes/skinMarketModerationRoutes'),{createSkinMarketModerationRouter:websiteRouter}=require('../server/routes/skinMarketModeration');
const listen=app=>new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
test('staff review APIs use a separate credential, current roles, exact receipts and independent preview guards',async t=>{
 const db=new DatabaseSync(':memory:'),staff='76561198000000701',other='76561198000000702',seller='76561198000000703',buyer='76561198000000704',creator='76561198000000705';let enabled=true,preview=false,sourcePreview=false,after=null,calls=0;
 db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY,steam_id TEXT,is_admin INTEGER)');db.prepare('INSERT INTO users VALUES(1,?,1),(2,?,0)').run(staff,other);
 const market=createSkinTradingService(store),moderation=createSkinMarketModeration(store,{enabled:()=>enabled,readOnly:()=>sourcePreview});
 const remoteApp=express();remoteApp.use(express.json());remoteApp.use('/api/admin/skin-market',sourceRouter({getService:()=>moderation,enabled:()=>enabled,readOnly:()=>sourcePreview}));const remote=await listen(remoteApp);process.env.AUTOMATION_SERVICE_URL='http://127.0.0.1:'+remote.address().port;
 const app=express();app.use(express.json());app.use((req,_res,next)=>{if(req.get('x-fixture-user'))req.user=db.prepare('SELECT * FROM users WHERE id=?').get(Number(req.get('x-fixture-user')));next();});app.use('/review',websiteRouter({db,enabled:()=>enabled,readOnly:()=>preview,client:{callAdmin:async(...args)=>{calls++;const result=await client.callAdmin(...args);after?.();return result;}}}));
 const server=await listen(app),origin='http://127.0.0.1:'+server.address().port;
 const send=(action,body={},user=1,headers={})=>fetch(origin+'/review/'+action,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,'x-fixture-user':String(user),'X-Skin-Market-Reviewer':user+':'+(user===1?staff:other),...headers},body:JSON.stringify(body)});
 try{
  const skin=Object.fromEntries(skins.COLOR_KEYS.map(key=>[key,{r:.2,g:.3,b:.4,a:1}]));Object.assign(skin,{skinVariation:1,patternIndex:2,themeIndex:3});const {preset}=await skins.createPresetFromStudio({steamId:creator,name:'HTTP moderation',species:'Triceratops',skin,idempotencyKey:randomUUID()});skins.publishPreset({presetId:preset.id,price:100});
  store.applyWalletTransaction({steamId:seller,amount:100,kind:'fixture',reason:'Synthetic listing funds',idempotencyKey:randomUUID()});skins.purchasePreset({steamId:seller,presetId:preset.id,idempotencyKey:randomUUID()});
  const live=createSkinTradingService(store,{enabled:()=>true}),id=live.offer({steam_id:seller},{presetId:preset.id,price:200,requestId:randomUUID()}).listing.id;
  assert.equal((await fetch(origin+'/review/capabilities')).status,401);assert.equal((await send('read',{id},2)).status,403);
  const caps=await fetch(origin+'/review/capabilities',{headers:{'x-fixture-user':'1'}});assert.equal(caps.headers.get('cache-control'),'private, no-store');assert.equal((await caps.json()).reviewerBinding,'1:'+staff);
  for(const headers of[{Origin:'https://foreign.invalid'},{Origin:''},{'X-Skin-Market-Reviewer':'2:'+other}])assert.equal((await send('read',{id},1,headers)).status,403);
  const before=calls;assert.equal((await send('read',{id,reviewerSteamId:other})).status,400);assert.equal((await send('read?id='+id,{id})).status,400);assert.equal(calls,before);
  const playerToken=await fetch(process.env.AUTOMATION_SERVICE_URL+'/api/admin/skin-market/read',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.HOLLOW_VALLEY_API_TOKEN},body:JSON.stringify({id,reviewerSteamId:staff})});assert.equal(playerToken.status,401);
  const input={action:'hold',target:preset.id,active:true,expectedRevision:0,requestId:randomUUID(),reason:'Private staff review of this reported design'};
  preview=true;assert.equal((await send('change',input)).status,403);assert.equal((await send('read',{id})).status,200);preview=false;sourcePreview=true;assert.equal((await send('change',input)).status,403);sourcePreview=false;
  assert.equal((await send('change',input)).status,200);const recovered=await(await send('receipt',{requestId:input.requestId})).json();assert.equal(recovered.receipt.active,true);assert.equal((await(await send('change',input)).json()).duplicate,true);
  assert.equal((await(await send('read',{id})).json()).hold.active,true);assert.throws(()=>live.offer({steam_id:seller},{presetId:preset.id,price:200,requestId:randomUUID()}),{status:409});
  after=()=>db.exec('UPDATE users SET is_admin=0 WHERE id=1');assert.equal((await send('read',{id})).status,403);after=null;db.exec('UPDATE users SET is_admin=1 WHERE id=1');
  after=()=>{enabled=false;};assert.equal((await send('read',{id})).status,503);after=null;enabled=true;
  await t.test('read-only source access cannot initialize missing review tables',async()=>{
   const empty=new DatabaseSync(':memory:');empty.exec('CREATE TABLE economy_skin_listings(id TEXT);CREATE TABLE economy_skin_trades(id TEXT);PRAGMA query_only=ON');
   const readApp=express();readApp.use(express.json());readApp.use('/source',sourceRouter({getStore:()=>({db:empty}),enabled:()=>true,readOnly:()=>true}));const readServer=await listen(readApp);
   try{const response=await fetch('http://127.0.0.1:'+readServer.address().port+'/source/read',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.AUTOMATION_ADMIN_TOKEN},body:JSON.stringify({id,reviewerSteamId:staff})});assert.equal(response.status,503);assert.equal(empty.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get().n,2);}
   finally{await new Promise(resolve=>readServer.close(resolve));empty.close();}
  });
 }finally{await Promise.all([server,remote].map(s=>new Promise(resolve=>s.close(resolve))));db.close();store.db.close();}
});
