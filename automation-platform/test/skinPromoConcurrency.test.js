const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Worker}=require('node:worker_threads'),{randomBytes}=require('node:crypto');
const workerSource=`
const {parentPort,workerData}=require('node:worker_threads');
process.env.AUTOMATION_DB_PATH=workerData.database;
const store=require(workerData.storePath);
const service=require(workerData.servicePath).createSkinPromoService(store,{enabled:()=>true});
parentPort.once('message',()=>{
  try{parentPort.postMessage({result:service[workerData.action](workerData.user,workerData.input)});}
  catch(e){parentPort.postMessage({error:e.message,status:e.status});}
  finally{store.db.close();}
});
parentPort.postMessage({ready:true});`;
async function worker(data){
  const instance=new Worker(workerSource,{eval:true,workerData:data});
  let readyResolve,readyReject,resultResolve,resultReject;
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const result=new Promise((resolve,reject)=>{resultResolve=resolve;resultReject=reject;});
  // Consume startup failures even if readiness rejects before callers await result.
  result.catch(()=>{});
  instance.on('message',message=>message.ready?readyResolve():resultResolve(message));
  instance.on('error',e=>{readyReject(e);resultReject(e);});
  const exit=new Promise(resolve=>instance.once('exit',resolve));
  await ready;return {start:()=>instance.postMessage('go'),result,exit,stop:()=>instance.terminate()};
}
test('independent workers consume a code once, survive reopening and serialize revocation', {timeout:30000},async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hv-promo-race-'));
  const database=path.join(dir,'economy.sqlite');
  process.env.AUTOMATION_DB_PATH=database;process.env.SKIN_SYSTEM_ENABLED='true';process.env.SKIN_PRESET_CREATE_COST='0';
  const storePath=require.resolve('../src/services/economyStore'),servicePath=require.resolve('../src/services/skinPromoService');
  const storagePath=require.resolve('../src/services/dinoStorageService');
  require.cache[storagePath]={id:storagePath,filename:storagePath,loaded:true,exports:{}};
  const store=require(storePath),skins=require('../src/services/skinPresetService');
  const service=require(servicePath).createSkinPromoService(store,{enabled:()=>true});
  const admin={steam_id:'76561198000000701',is_admin:true},a={steam_id:'76561198000000702'},b={steam_id:'76561198000000703'};
  const children=[];
  async function launch(action,user,input){const child=await worker({database,storePath,servicePath,action,user,input});children.push(child);return child;}
  async function fixture(){
    const skin=Object.fromEntries(skins.COLOR_KEYS.map(key=>[key,{r:0.2,g:0.3,b:0.4,a:1}]));Object.assign(skin,{skinVariation:1,patternIndex:2,themeIndex:3});
    const preset=(await skins.createPresetFromStudio({steamId:admin.steam_id,species:'Triceratops',name:'Concurrency fixture',skin,idempotencyKey:randomBytes(16).toString('hex')})).preset;
    const code=`HVP-${randomBytes(32).toString('hex')}`;
    const {id}=service.issue(admin,{presetId:preset.id,code,reason:'Approved competition fixture',expiresAt:Date.now()+86400000,requestId:randomBytes(16).toString('hex')});return {id,code,preset};
  }
  try{
    const first=await fixture();
    const contenders=await Promise.all([launch('redeem',a,{code:first.code}),launch('redeem',b,{code:first.code})]);
    contenders.forEach(child=>child.start());const results=await Promise.all(contenders.map(child=>child.result));
    assert.equal(results.filter(r=>r.result?.duplicate===false).length,1);assert.equal(results.filter(r=>r.status===409).length,1);
    await Promise.all(contenders.map(child=>child.exit));
    const unlocks=store.db.prepare('SELECT * FROM economy_skin_unlocks WHERE preset_id=?').all(first.preset.id);assert.equal(unlocks.length,1);
    const saved=store.db.prepare('SELECT * FROM economy_skin_promos WHERE code_hash=?').get(first.id);assert.equal(saved.redeemed_by,unlocks[0].steam_id);
    const reopened=await launch('redeem',{steam_id:saved.redeemed_by},{code:first.code});reopened.start();assert.equal((await reopened.result).result.duplicate,true);await reopened.exit;
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM economy_wallet_ledger').get().n,0);
    const second=await fixture();
    const racers=await Promise.all([launch('redeem',a,{code:second.code}),launch('revoke',admin,{id:second.id,reason:'Competition withdrawn before claiming'})]);
    racers.forEach(child=>child.start());const outcomes=await Promise.all(racers.map(child=>child.result));await Promise.all(racers.map(child=>child.exit));
    assert.equal(outcomes.filter(r=>r.result).length,1);assert.equal(outcomes.filter(r=>r.status===409).length,1);
    const final=store.db.prepare('SELECT * FROM economy_skin_promos WHERE code_hash=?').get(second.id);
    assert.notEqual(final.redeemed_at!==null,final.revoked_at!==null);
    assert.equal(store.hasSkinUnlock(a.steam_id,second.preset.id),final.redeemed_at!==null);
    const third=await fixture();
    store.db.exec(`CREATE TRIGGER reject_consumption BEFORE UPDATE OF redeemed_by ON economy_skin_promos BEGIN SELECT RAISE(ABORT,'fixture disk failure'); END`);
    assert.throws(()=>service.redeem(b,{code:third.code}),/fixture disk failure/);
    assert.equal(store.hasSkinUnlock(b.steam_id,third.preset.id),false);
    assert.equal(store.db.prepare('SELECT redeemed_by FROM economy_skin_promos WHERE code_hash=?').get(third.id).redeemed_by,null);
    store.db.exec('DROP TRIGGER reject_consumption');
    assert.equal(service.redeem(b,{code:third.code}).duplicate,false);
  }finally{
    await Promise.all(children.map(child=>child.stop()));store.db.close();
    const resolved=path.resolve(dir);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('hv-promo-race-'));
    fs.rmSync(resolved,{recursive:true,force:true});
  }
});
