const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
process.env.AUTOMATION_DB_PATH=':memory:';process.env.SKIN_SYSTEM_ENABLED='true';process.env.SKIN_LIVE_WEAR_ENABLED='true';process.env.SKIN_PRESET_CREATE_COST='0';
const stub=(name,exports)=>{const id=require.resolve('../src/services/'+name);require.cache[id]={id,filename:id,loaded:true,exports};};
stub('dinoStorageService',{});
const queued=[];let duringSnapshot=()=>{},publicationError=null,outcome={state:'confirmed'};
stub('statusService',{getServerSnapshot:async()=>{duringSnapshot();return {online:true,characters:[]};}});
stub('commandBridgeService',{buildCommand:()=>({id:randomUUID()}),queueCommand:async command=>{queued.push(command);if(publicationError)throw publicationError;},readOutcome:async()=>outcome});
const store=require('../src/services/economyStore'),skins=require('../src/services/skinPresetService'),wear=require('../src/services/skinWearService');
const gifts=require('../src/services/skinGiftService').createSkinGiftService(store,{enabled:()=>true});
const creator={steam_id:'76561198000000301'},sender={steam_id:'76561198000000302'},recipient={steam_id:'76561198000000303'};
test.after(()=>store.db.close());
async function fixture(){
  const skin=Object.fromEntries(skins.COLOR_KEYS.map(k=>[k,{r:0.1,g:0.2,b:0.3,a:1}]));Object.assign(skin,{skinVariation:1,patternIndex:2,themeIndex:3});
  const {preset}=await skins.createPresetFromStudio({steamId:creator.steam_id,name:'Wear gift fixture',species:'Triceratops',skin,idempotencyKey:randomUUID()});
  skins.publishPreset({presetId:preset.id,price:100});store.applyWalletTransaction({steamId:sender.steam_id,amount:100,kind:'fixture',reason:'Fixture funding',idempotencyKey:randomUUID()});
  skins.purchasePreset({steamId:sender.steam_id,presetId:preset.id,idempotencyKey:randomUUID()});
  const {id}=gifts.offer(sender,{presetId:preset.id,recipientSteamId:recipient.steam_id,requestId:randomUUID()});return {preset,id};
}
test('a transfer committed during the snapshot wait prevents the former owner queueing a skin command',async()=>{
  const {preset,id}=await fixture();duringSnapshot=()=>gifts.decide(recipient,{id,decision:'accepted',expectedRevision:0});
  await assert.rejects(wear.wearPreset({steamId:sender.steam_id,presetId:preset.id}),{code:'SKIN_PRESET_NOT_FOUND'});
  assert.equal(queued.length,0);assert.equal(store.listSkinApplyJobs(sender.steam_id).length,0);
  assert.equal(store.hasSkinUnlock(recipient.steam_id,preset.id),true);duringSnapshot=()=>{};
});
test('a queued application prevents acceptance until its outcome is terminal',async()=>{
  const {preset,id}=await fixture(),job=randomUUID();
  store.createSkinApplyJob({id:job,steamId:sender.steam_id,presetId:preset.id,species:preset.species,skin:preset.skin});
  assert.throws(()=>gifts.decide(recipient,{id,decision:'accepted',expectedRevision:0}),{status:409});
  assert.equal(store.hasSkinUnlock(sender.steam_id,preset.id),true);
  store.updateSkinApplyJob({id:job,status:'verified',completed:true});
  gifts.decide(recipient,{id,decision:'accepted',expectedRevision:0});assert.equal(store.hasSkinUnlock(recipient.steam_id,preset.id),true);
  assert.equal(queued.length,0);
});

test('uncertain Wear Live publication retains the gift hold until an explicit outcome',async()=>{
  const {preset,id}=await fixture();
  publicationError=new Error('Publisher response lost');
  try {
    await assert.rejects(wear.wearPreset({steamId:sender.steam_id,presetId:preset.id}),publicationError);
    const job=store.getSkinApplyJob(publicationError.requestId);
    assert.equal(job.status,'awaiting_confirmation');assert.equal(job.completed_at,null);
    for(const state of [null,'acknowledged']) {
      outcome=state?{state}:null;
      await wear.reconcileWearState(sender.steam_id);
      assert.throws(()=>gifts.decide(recipient,{id,decision:'accepted',expectedRevision:0}),{status:409});
      assert.equal(store.hasSkinUnlock(sender.steam_id,preset.id),true);
    }
    const before=queued.length;outcome={state:'confirmed'};
    await wear.reconcileWearState(sender.steam_id);
    assert.equal(queued.length,before);
    gifts.decide(recipient,{id,decision:'accepted',expectedRevision:0});
    assert.equal(store.hasSkinUnlock(recipient.steam_id,preset.id),true);
  } finally {publicationError=null;outcome={state:'confirmed'};}
});

test('proven pre-publication rejection releases the Wear Live gift hold',async()=>{
  const {preset,id}=await fixture();
  publicationError=Object.assign(new Error('Publisher disabled'),{commandNotPublished:true});
  try {
    await assert.rejects(wear.wearPreset({steamId:sender.steam_id,presetId:preset.id}),publicationError);
    const job=store.getSkinApplyJob(publicationError.requestId);
    assert.equal(job.status,'failed');assert.ok(job.completed_at);
    gifts.decide(recipient,{id,decision:'accepted',expectedRevision:0});
    assert.equal(store.hasSkinUnlock(recipient.steam_id,preset.id),true);
  } finally {publicationError=null;}
});

test('an old unresolved Wear Live request cannot be resent by retry',async()=>{
  const {preset,id}=await fixture(),job=randomUUID();
  store.createSkinApplyJob({id:job,steamId:sender.steam_id,presetId:preset.id,species:preset.species,skin:preset.skin});
  store.db.prepare("UPDATE economy_skin_apply_jobs SET updated_at='2000-01-01 00:00:00' WHERE id=?").run(job);
  const before=queued.length;
  try {
    for(const state of [null,'acknowledged']) {
      outcome=state?{state}:null;
      await assert.rejects(wear.retryLastWear(sender.steam_id),{code:'SKIN_WEAR_STILL_PENDING'});
      assert.equal(queued.length,before);
      assert.throws(()=>gifts.decide(recipient,{id,decision:'accepted',expectedRevision:0}),{status:409});
    }
    outcome={state:'failed',message:'Explicit game rejection'};
    await wear.reconcileWearState(sender.steam_id);
    assert.equal(store.getSkinApplyJob(job).status,'failed');
    outcome={state:'confirmed'};
    await wear.retryLastWear(sender.steam_id);
    assert.equal(queued.length,before+1);
    assert.notEqual(queued.at(-1).id,job);
  } finally {outcome={state:'confirmed'};}
});

test('gift recovery pages through historical live holds without resending or overwriting a newer assignment',async()=>{
  const steam='76561198000000401',other='76561198000000402',ids=[],reads=[];
  const add=(actor,id)=>store.createSkinApplyJob({id,steamId:actor,presetId:'recovery-fixture',species:'Triceratops',skin:{}});
  for(let i=0;i<12;i++){const id=randomUUID();ids.push(id);add(steam,id);}
  const unrelated=randomUUID();add(other,unrelated);
  const newer=randomUUID();add(steam,newer);store.updateSkinApplyJob({id:newer,status:'verified',completed:true});
  store.upsertSkinLiveAssignment({steamId:steam,presetId:'newer-skin',species:'Triceratops',skin:{},requestId:newer,status:'verified'});
  const recovery=require('../src/services/skinGiftLiveRecovery').createSkinGiftLiveRecovery(store,{readOutcome:async command=>{
    reads.push(command);if(command.id===ids[0])return null;if(command.id===ids[1])return {state:'acknowledged'};
    if(command.id===ids[2])throw new Error('Unreachable');
    return {state:command.id===ids[3]?'failed':'confirmed'};
  }});
  const before=queued.length,first=await recovery.reconcile(steam);
  assert.equal(first.checked,10);assert.equal(first.resolved,7);assert.equal(first.pending,5);assert.ok(first.nextCursor);
  const second=await recovery.reconcile(steam,{cursor:first.nextCursor});
  assert.deepEqual(second,{checked:2,resolved:2,pending:3,nextCursor:null});
  assert.equal(reads.length,12);assert.ok(reads.every(c=>c.steam===steam&&c.verb==='skin_apply'&&ids.includes(c.id)));
  assert.equal(queued.length,before);assert.equal(store.getSkinApplyJob(unrelated).status,'queued');
  assert.equal(store.getSkinLiveAssignment(steam).request_id,newer);
  await assert.rejects(recovery.reconcile(steam,{cursor:-1}),{status:400});
  await assert.rejects(recovery.reconcile(steam,{cursor:'1'}),{status:400});
});

test('gifting recovery releases a confirmed historical hold for acceptance',async()=>{
  const {preset,id}=await fixture(),old=randomUUID(),newer=randomUUID();
  store.createSkinApplyJob({id:old,steamId:sender.steam_id,presetId:preset.id,species:preset.species,skin:preset.skin});
  store.createSkinApplyJob({id:newer,steamId:sender.steam_id,presetId:'different-skin',species:preset.species,skin:preset.skin});
  store.updateSkinApplyJob({id:newer,status:'verified',completed:true});
  assert.throws(()=>gifts.decide(recipient,{id,decision:'accepted',expectedRevision:0}),{status:409});
  const before=queued.length;outcome={state:'confirmed'};
  const result=await gifts.reconcile(sender);
  assert.ok(result.resolved>=1);assert.equal(store.getSkinApplyJob(old).status,'verified');
  assert.equal(queued.length,before);
  gifts.decide(recipient,{id,decision:'accepted',expectedRevision:0});
  assert.equal(store.hasSkinUnlock(recipient.steam_id,preset.id),true);
});
