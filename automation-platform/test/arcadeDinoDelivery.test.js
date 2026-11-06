'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-delivery-'));
process.env.AUTOMATION_DB_PATH=path.join(dir,'test.sqlite');
process.env.VALLEY_ARCADE_DINO_DELIVERY_ENABLED='1';
process.env.COMMAND_BRIDGE_TRANSPORT='http_pull';process.env.COMMAND_BRIDGE_ENABLED='true';
process.env.COMMAND_BRIDGE_SINGLE_PUBLISHER_ACK='automation-platform-is-sole-publisher';
process.env.BINARYLANE_COMMAND_TOKEN='test-only';process.env.COMMAND_BRIDGE_HTTP_RESULT_FTP_FALLBACK='false';
const delivery=require('../src/services/arcadeDinoDelivery'),store=require('../src/services/economyStore');
const bridge=require('../src/services/commandBridgeService'),http=require('../src/services/commandBridgeHttpService');
const capacity=require('../src/services/dinoStorageCapacityService');
const db=store.db;delivery.schema();
const steam='76561198000000100';
function reward(species='omniraptor',growthPercent=25){const row={id:randomUUID(),steam_id:steam,reward_json:JSON.stringify({type:'dinosaur',species,growthPercent}),created_at:Date.now(),status:'ready'};db.prepare('INSERT INTO arcade_entitlements(id,steam_id,reward_json,created_at) VALUES (?,?,?,?)').run(row.id,steam,row.reward_json,row.created_at);return row;}
function progress(row){return db.prepare('SELECT * FROM arcade_dino_deliveries WHERE entitlement_id=?').get(row.id);}
const command=row=>JSON.parse(progress(row).command_json);
const count=()=>db.prepare("SELECT count(*) n FROM command_bridge_http_requests WHERE verb='dino_grant'").get().n;
test('known species and exact growth use existing grant protocol without prime or purchases',()=>{
 for(const species of ['omniraptor','carnotaurus','triceratops','tyrannosaurus','deinosuchus'])for(const growth of [25,49,75,100]){
 const row=reward(species,growth),cmd=delivery.buildCommand(row);
 assert.equal(cmd.args.args[2],(growth/100).toFixed(6));assert.equal(cmd.args.args[3],'0');
 assert.equal(cmd.args.args[4],`arcade:${row.id}`);assert.match(cmd.args.args[0],/^arcade_[a-f0-9]{32}$/);
 }
 assert.throws(()=>delivery.buildCommand(reward('not-a-dinosaur')),/Unsupported/);
 assert.throws(()=>delivery.buildCommand(reward('omniraptor',101)),/Unsupported/);
});
test('queue and receipt commit atomically; positive server result marks delivered once',async()=>{
 const row=reward();const before=count();await delivery.deliver(row);const cmd=command(row);
 assert.equal(progress(row).status,'queued');assert.equal(http.getRequest(cmd.id).status,'pending');
 await delivery.deliver(row);assert.equal(count(),before+1);
 http.acceptResult({id:cmd.id,steam,source:'DinoStorage',ok:true,msg:'marketplace slot created'});
 await delivery.deliver(row);await delivery.deliver(row);
 assert.equal(progress(row).status,'delivered');assert.equal(db.prepare('SELECT status FROM arcade_entitlements WHERE id=?').get(row.id).status,'delivered');
 assert.equal(delivery.snapshot('76561198000000101').length,0);
 assert.equal(db.prepare("SELECT count(*) n FROM arcade_rewards_audit WHERE action='dinosaur_delivery' AND details_json LIKE ?").get(`%${row.id}%`).n,2);
 assert.equal(count(),before+1);
});
test('crash during publication rolls back queue insertion; restart safely queues one command',async()=>{
 const row=reward();const before=count();
 db.exec("CREATE TRIGGER fail_delivery_audit BEFORE INSERT ON arcade_rewards_audit WHEN NEW.actor='arcade-delivery' BEGIN SELECT RAISE(ABORT,'injected audit failure'); END");
 await assert.rejects(delivery.deliver(row),/injected/);assert.equal(count(),before);assert.equal(progress(row).status,'waiting');
 db.exec('DROP TRIGGER fail_delivery_audit');db.prepare('UPDATE arcade_dino_deliveries SET next_attempt=0 WHERE entitlement_id=?').run(row.id);
 await delivery.deliver(row);assert.equal(count(),before+1);
});
test('concurrent publishers share the persisted command and enqueue once',async()=>{
 const row=reward();const before=count();await Promise.all([delivery.deliver(row),delivery.deliver(row),delivery.deliver(row)]);
 assert.equal(count(),before+1);assert.equal(progress(row).status,'queued');
});
test('full storage preserves owned reward and retries only before dispatch',async()=>{
 const original=capacity.guardCommand;const row=reward();const before=count();
 capacity.guardCommand=async()=>{throw Object.assign(new Error('full'),{code:'DINOSTORAGE_CAPACITY_FULL'});};
 try{await assert.rejects(delivery.deliver(row),/full/);}finally{capacity.guardCommand=original;}
 assert.equal(count(),before);assert.match(progress(row).message,/Storage is full/);assert.equal(progress(row).status,'waiting');
 db.prepare('UPDATE arcade_dino_deliveries SET next_attempt=0 WHERE entitlement_id=?').run(row.id);await delivery.deliver(row);assert.equal(count(),before+1);
});
test('lost or expired confirmation is never republished, even after slot withdrawal',async()=>{
 const row=reward();await delivery.deliver(row);const cmd=command(row);const before=count();
 db.prepare('DELETE FROM command_bridge_http_requests WHERE id=?').run(cmd.id);
 await delivery.deliver(row);await delivery.deliver(row);assert.equal(progress(row).status,'review');assert.equal(count(),before-1);
});
test('acknowledgement is not delivery; failed result holds reward for review',async()=>{
 const row=reward();await delivery.deliver(row);const cmd=command(row);
 http.acceptResult({id:cmd.id,steam,verb:'dino_grant',ok:true,msg:'accepted'});
 await delivery.deliver(row);assert.equal(progress(row).status,'queued');
 http.acceptResult({id:cmd.id,steam,source:'DinoStorage',ok:false,msg:'target slot contains another dinosaur'});
 await delivery.deliver(row);const before=count();await delivery.deliver(row);
 assert.equal(progress(row).status,'failed');assert.equal(count(),before);
 assert.equal(db.prepare('SELECT status FROM arcade_entitlements WHERE id=?').get(row.id).status,'ready');
});
test('unsupported old rewards are retained for review; delivery flag prevents backfill',async()=>{
 const row=reward('unknown');await delivery.deliver(row);assert.equal(progress(row).status,'failed');
 process.env.VALLEY_ARCADE_DINO_DELIVERY_ENABLED='0';const before=count();assert.equal((await delivery.reconcile()).skipped,true);assert.equal(count(),before);
 process.env.VALLEY_ARCADE_DINO_DELIVERY_ENABLED='1';
});

test('crate award reaches durable delivery and server confirmation without wallet debit',async()=>{
 process.env.VALLEY_ARCADE_ENABLED='1';process.env.VALLEY_ARCADE_REWARDS_ENABLED='1';
 const rewards=require('../src/services/arcadeRewards');require('../src/services/valleyArcade').configure('test',{enabled:true,emergency:false,cap:250000});
 const config=rewards.config();config.crates.event=[{id:'dino',label:'75% Rex',type:'dinosaur',species:'tyrannosaurus',growthPercent:75,weight:1}];
 rewards.configure('test',config,config.version);store.ensureWallet(steam);const balance=store.getWallet(steam).balance;
 const id=rewards.grant('test',steam,randomUUID(),{kind:'crate',family:'event',amount:1,source:'event'}).crateIds[0];
 const opened=rewards.open(steam,randomUUID(),id);const row=db.prepare('SELECT * FROM arcade_entitlements WHERE id=?').get(opened.reward.entitlementId);
 await delivery.deliver(row);const cmd=command(row);
 assert.equal(http.acceptResult({id:cmd.id,steam:'76561198000000101',source:'DinoStorage',ok:true,msg:'wrong owner'}).accepted,false);
 http.acceptResult({id:cmd.id,steam,source:'OtherMod',ok:true,msg:'wrong source'});await delivery.deliver(row);assert.equal(progress(row).status,'queued');
 http.acceptResult({id:cmd.id,steam,source:'DinoStorage',ok:true,msg:'created'});await delivery.deliver(row);
 const state=rewards.state(steam);assert.equal(state.deliveries.find(d=>d.entitlement_id===row.id).status,'delivered');
 assert.equal(store.getWallet(steam).balance,balance);assert.equal(rewards.open(steam,randomUUID(),id).alreadyOpened,true);
});
