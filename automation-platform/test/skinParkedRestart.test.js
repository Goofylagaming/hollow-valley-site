const test=require('node:test'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const source=`
const fs=require('node:fs');
const input=JSON.parse(process.env.HV_PARKED_FIXTURE);
process.env.AUTOMATION_DB_PATH=input.database;
const store=require(input.storePath);
const sender={steam_id:'76561198000000102'},recipient={steam_id:'76561198000000103'};
const gifts=require(input.giftPath).createSkinGiftService(store,{enabled:()=>true});
const reads=[];
const parked=require(input.parkedPath).createSkinParkedApplicationService(store,{
  now:()=>Date.now()+(input.action==='reserve'?0:365*86400000),
  readOutcome:async command=>{reads.push(command.id);if(input.state==='unreachable')throw new Error('fixture offline');return {state:input.state};}
});
(async()=>{
  let result;
  if(input.action==='reserve'){
    for(const id of ['76561198000000101',sender.steam_id,recipient.steam_id])store.ensureWallet(id);
    store.db.prepare('INSERT INTO economy_skin_presets(id,owner_steam_id,species,name,skin_json) VALUES (?,?,?,?,?)').run('fixture-skin','76561198000000101','Triceratops','Fixture','{}');
    store.db.prepare('INSERT INTO economy_skin_unlocks(steam_id,preset_id,idempotency_key) VALUES (?,?,?)').run(sender.steam_id,'fixture-skin','fixture-original-unlock');
    const offer=gifts.offer(sender,{presetId:'fixture-skin',recipientSteamId:recipient.steam_id,requestId:'fixture-offer'});
    parked.reserve({command:{id:'fixture-original-command',verb:'dino_edit',steam:sender.steam_id},steamId:sender.steam_id,presetId:'fixture-skin',slot:'fixture-slot',validate:()=>{if(!store.hasSkinUnlock(sender.steam_id,'fixture-skin'))throw new Error('ownership missing');}});
    // Exit without closing the connection, as an interrupted publisher could.
    fs.writeSync(1,JSON.stringify({giftId:offer.id}));process.exit(0);
  }else if(input.action==='reconcile')result={...(await parked.reconcile(sender.steam_id)),reads};
  else if(input.action==='accept'){
    try{result=gifts.decide(recipient,{id:input.giftId,decision:'accepted',expectedRevision:0});}catch(e){result={status:e.status};}
  }else result={sender:store.hasSkinUnlock(sender.steam_id,'fixture-skin'),recipient:store.hasSkinUnlock(recipient.steam_id,'fixture-skin'),holds:store.db.prepare('SELECT id,status FROM economy_skin_parked_applications').all(),unlocks:store.db.prepare('SELECT COUNT(*) n FROM economy_skin_unlocks').get().n};
  store.db.close();fs.writeSync(1,JSON.stringify(result));
})().catch(e=>{console.error(e);process.exitCode=1;});`;
test('parked holds survive process exit and release only after a matching definitive outcome', {timeout:30000},()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hv-parked-restart-'));
  const common={database:path.join(dir,'fixture.sqlite'),storePath:require.resolve('../src/services/economyStore'),giftPath:require.resolve('../src/services/skinGiftService'),parkedPath:require.resolve('../src/services/skinParkedApplicationService')};
  const run=input=>JSON.parse(execFileSync(process.execPath,['-e',source],{env:{...process.env,HV_PARKED_FIXTURE:JSON.stringify({...common,...input})},encoding:'utf8',timeout:10000}));
  try{
    const {giftId}=run({action:'reserve'});
    assert.deepEqual(run({action:'accept',giftId}),{status:409});
    for(const state of [undefined,'acknowledged','unreachable']){
      const result=run({action:'reconcile',state});assert.equal(result.pending,1);assert.equal(result.resolved,0);assert.deepEqual(result.reads,['fixture-original-command']);
      assert.deepEqual(run({action:'accept',giftId}),{status:409});
    }
    const before=run({action:'inspect'});assert.equal(before.sender,true);assert.equal(before.recipient,false);assert.equal(before.unlocks,1);
    assert.deepEqual(run({action:'reconcile',state:'confirmed'}),{checked:1,resolved:1,pending:0,reads:['fixture-original-command']});
    assert.equal(run({action:'accept',giftId}).duplicate,false);
    assert.equal(run({action:'accept',giftId}).duplicate,true);
    const after=run({action:'inspect'});assert.equal(after.sender,false);assert.equal(after.recipient,true);assert.equal(after.unlocks,1);
    assert.deepEqual(after.holds,[{id:'fixture-original-command',status:'confirmed'}]);
  }finally{
    const resolved=path.resolve(dir);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('hv-parked-restart-'));
    fs.rmSync(resolved,{recursive:true,force:true});
  }
});
