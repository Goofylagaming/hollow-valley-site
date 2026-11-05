const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Worker}=require('node:worker_threads'),{randomBytes}=require('node:crypto');
const workerSource=`
const {parentPort,workerData}=require('node:worker_threads');
process.env.AUTOMATION_DB_PATH=workerData.database;
const store=require(workerData.storePath);
const service=require(workerData.servicePath).createSkinGiftService(store,{enabled:()=>true});
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
test('independent gifting workers serialize offers, acceptance retries and cancellation', {timeout:30000},async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hv-gift-race-')),database=path.join(dir,'economy.sqlite');
  process.env.AUTOMATION_DB_PATH=database;process.env.SKIN_SYSTEM_ENABLED='true';process.env.SKIN_PRESET_CREATE_COST='0';
  const storePath=require.resolve('../src/services/economyStore'),servicePath=require.resolve('../src/services/skinGiftService');
  const storagePath=require.resolve('../src/services/dinoStorageService');require.cache[storagePath]={id:storagePath,filename:storagePath,loaded:true,exports:{}};
  const store=require(storePath),skins=require('../src/services/skinPresetService'),gifts=require(servicePath).createSkinGiftService(store,{enabled:()=>true});
  const creator={steam_id:'76561198000000201'},sender={steam_id:'76561198000000202'},a={steam_id:'76561198000000203'},b={steam_id:'76561198000000204'};
  const children=[],key=()=>randomBytes(16).toString('hex');
  async function race(actions){
    const racers=await Promise.all(actions.map(async([action,user,input])=>{const child=await worker({database,storePath,servicePath,action,user,input});children.push(child);return child;}));
    racers.forEach(c=>c.start());const results=await Promise.all(racers.map(c=>c.result));await Promise.all(racers.map(c=>c.exit));return results;
  }
  async function fixture(){
    const skin=Object.fromEntries(skins.COLOR_KEYS.map(k=>[k,{r:0.1,g:0.2,b:0.3,a:1}]));Object.assign(skin,{skinVariation:1,patternIndex:2,themeIndex:3});
    const {preset}=await skins.createPresetFromStudio({steamId:creator.steam_id,name:'Race fixture',species:'Triceratops',skin,idempotencyKey:key()});
    skins.publishPreset({presetId:preset.id,price:100});store.applyWalletTransaction({steamId:sender.steam_id,amount:100,kind:'fixture',reason:'Fixture funding',idempotencyKey:key()});
    skins.purchasePreset({steamId:sender.steam_id,presetId:preset.id,idempotencyKey:key()});return preset;
  }
  try{
    const first=await fixture();
    const offered=await race([a,b].map(user=>['offer',sender,{presetId:first.id,recipientSteamId:user.steam_id,requestId:key()}]));
    assert.equal(offered.filter(r=>r.result).length,1);assert.equal(offered.filter(r=>r.status===409).length,1);
    const pending=store.db.prepare('SELECT * FROM economy_skin_gifts WHERE preset_id=?').get(first.id);
    const decision={id:pending.id,decision:'accepted',expectedRevision:0};
    const accepted=await race([['decide',{steam_id:pending.recipient},decision],['decide',{steam_id:pending.recipient},decision]]);
    assert.deepEqual(accepted.map(r=>r.result.duplicate).sort(),[false,true]);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM economy_skin_unlocks WHERE preset_id=?').get(first.id).n,1);
    assert.equal(store.hasSkinUnlock(pending.recipient,first.id),true);assert.equal(store.hasSkinUnlock(sender.steam_id,first.id),false);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM economy_skin_gift_decisions WHERE gift_id=?').get(pending.id).n,1);
    const reopened=await race([['decide',{steam_id:pending.recipient},decision]]);assert.equal(reopened[0].result.duplicate,true);
    const second=await fixture(),{id}=gifts.offer(sender,{presetId:second.id,recipientSteamId:a.steam_id,requestId:key()});
    const results=await race([['decide',a,{id,decision:'accepted',expectedRevision:0}],['decide',sender,{id,decision:'cancelled',expectedRevision:0}]]);
    assert.equal(results.filter(r=>r.result).length,1);assert.equal(results.filter(r=>r.status===409).length,1);
    const final=store.db.prepare('SELECT state FROM economy_skin_gifts WHERE id=?').get(id).state;
    assert.equal(store.hasSkinUnlock(sender.steam_id,second.id),final==='cancelled');
    assert.equal(store.hasSkinUnlock(a.steam_id,second.id),final==='accepted');
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM economy_skin_unlocks WHERE preset_id=?').get(second.id).n,1);
  }finally{
    await Promise.all(children.map(c=>c.stop()));store.db.close();
    const resolved=path.resolve(dir);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('hv-gift-race-'));fs.rmSync(resolved,{recursive:true,force:true});
  }
});
