'use strict';
const store = require('./economyStore');
const rewards = require('./arcadeRewards');
const bridge = require('./commandBridgeService');
const http = require('./commandBridgeHttpService');
const capacity = require('./dinoStorageCapacityService');
const { classPathForSpecies } = require('./officialMarketplaceCatalogService');
const db = store.db;
const enabled = () => process.env.VALLEY_ARCADE_DINO_DELIVERY_ENABLED === '1';

function schema() {
  rewards.schema();
  db.exec(`CREATE TABLE IF NOT EXISTS arcade_dino_deliveries (
    entitlement_id TEXT PRIMARY KEY, command_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'waiting', message TEXT,
    next_attempt INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS arcade_dino_delivery_pending ON arcade_dino_deliveries(status,next_attempt);`);
}
function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result=fn(); db.exec('COMMIT'); return result; }
  catch(error) { db.exec('ROLLBACK'); throw error; }
}
function audit(id, status) {
  db.prepare('INSERT INTO arcade_rewards_audit(actor,action,details_json,created_at) VALUES (?,?,?,?)')
    .run('arcade-delivery', 'dinosaur_delivery', JSON.stringify({entitlementId:id,status}), Date.now());
}
function buildCommand(entitlement) {
  const reward=JSON.parse(entitlement.reward_json);
  const classPath=classPathForSpecies(reward.species);
  if (!classPath || !Number.isInteger(reward.growthPercent) || reward.growthPercent<1 || reward.growthPercent>100)
    throw new Error('Unsupported dinosaur reward; admin review required.');
  if (!/^[a-f0-9-]{36}$/i.test(entitlement.id)) throw new Error('Invalid entitlement ID');
  // Full UUID, never truncated. Existing DinoStorage grant protocol stores this
  // earned-reward marker without creating a purchase or charging a wallet.
  return bridge.buildCommand('dino_grant', entitlement.steam_id, [
    `arcade_${entitlement.id.replaceAll('-','')}`, classPath,
    (reward.growthPercent/100).toFixed(6), '0', `arcade:${entitlement.id}`,
    'arcade-earned', reward.species.toLowerCase(),
  ]);
}
function snapshot(steam) {
  schema();
  return db.prepare(`SELECT d.entitlement_id,d.status,d.message,d.command_json FROM arcade_dino_deliveries d
    JOIN arcade_entitlements e ON e.id=d.entitlement_id WHERE e.steam_id=?`).all(steam)
    .map(({command_json,...row})=>({...row,slot:JSON.parse(command_json).args?.args?.[0]||null}));
}
async function deliver(entitlement) {
  let progress=db.prepare('SELECT * FROM arcade_dino_deliveries WHERE entitlement_id=?').get(entitlement.id);
  if (!progress) {
    let command;
    try { command=buildCommand(entitlement); }
    catch(error) {
      db.prepare("INSERT OR IGNORE INTO arcade_dino_deliveries(entitlement_id,command_json,status,message,updated_at) VALUES (?,'{}','failed',?,?)")
        .run(entitlement.id,'Unsupported reward. Admin review required; your reward remains owned.',Date.now());
      return;
    }
    db.prepare('INSERT OR IGNORE INTO arcade_dino_deliveries(entitlement_id,command_json,updated_at) VALUES (?,?,?)')
      .run(entitlement.id,JSON.stringify(command),Date.now());
    progress=db.prepare('SELECT * FROM arcade_dino_deliveries WHERE entitlement_id=?').get(entitlement.id);
  }
  const command=JSON.parse(progress.command_json);
  if (progress.status==='delivered' || progress.status==='failed') return;
  if (progress.status==='queued' || progress.status==='review') {
    db.prepare('UPDATE arcade_dino_deliveries SET next_attempt=? WHERE entitlement_id=?').run(Date.now()+15000,entitlement.id);
    // Never republish dispatched/uncertain work, even if HTTP history expired.
    const outcome=await bridge.readOutcome(command);
    if (outcome?.state==='confirmed' && outcome.source==='DinoStorage') {
      transaction(()=>{
        const changed=db.prepare("UPDATE arcade_dino_deliveries SET status='delivered',message=NULL,updated_at=? WHERE entitlement_id=? AND status IN ('queued','review')")
          .run(Date.now(),entitlement.id).changes;
        if (!changed) return;
        db.prepare("UPDATE arcade_entitlements SET status='delivered' WHERE id=?").run(entitlement.id);
        audit(entitlement.id,'delivered');
      });
      capacity.markMaterialized(`official:arcade:${entitlement.id}`,command.id);
      require('./dinoStorageService').invalidateStoredDinoCache(entitlement.steam_id);
    } else if (outcome?.state==='failed') {
      transaction(()=>{
        db.prepare("UPDATE arcade_dino_deliveries SET status='failed',message=?,updated_at=? WHERE entitlement_id=?")
          .run('Delivery needs admin review. Your reward remains owned.',Date.now(),entitlement.id);
        audit(entitlement.id,'failed');
      });
    } else if (!http.getRequest(command.id) || Date.now()-progress.updated_at>300000) {
      db.prepare("UPDATE arcade_dino_deliveries SET status='review',message=? WHERE entitlement_id=?")
        .run('Waiting for server confirmation. The command will not be repeated.',entitlement.id);
    }
    return;
  }
  if (progress.next_attempt>Date.now()) return;
  bridge.assertPublisherReady();
  if (bridge.getTransport()!=='http_pull' || !bridge.transportConfigured()) throw new Error('Automatic Arcade delivery requires configured HTTP-pull CommandBridge');
  try {
    await capacity.guardCommand(command);
    if (!enabled()) return;
    transaction(()=>{
      const current=db.prepare('SELECT status FROM arcade_dino_deliveries WHERE entitlement_id=?').get(entitlement.id);
      if(current.status!=='waiting') return;
      // Same SQLite transaction as the delivery record: a crash cannot leave
      // an untracked command or a queued reward with no command to dispatch.
      db.prepare(`INSERT INTO command_bridge_http_requests(id,verb,steam,expected_source,payload,status)
        VALUES (?,?,?,'DinoStorage',?,'pending')`).run(command.id,command.verb,command.steam,JSON.stringify(command));
      db.prepare("UPDATE arcade_dino_deliveries SET status='queued',message=NULL,updated_at=? WHERE entitlement_id=?")
        .run(Date.now(),entitlement.id);
      audit(entitlement.id,'queued');
    });
  } catch(error) {
    const message=error.code==='DINOSTORAGE_CAPACITY_FULL'
      ? 'Storage is full. Delivery will retry automatically when space is available.'
      : 'Waiting for a safe storage connection. Delivery will retry automatically.';
    db.prepare("UPDATE arcade_dino_deliveries SET message=?,next_attempt=?,updated_at=? WHERE entitlement_id=? AND status='waiting'")
      .run(message,Date.now()+60000,Date.now(),entitlement.id);
    throw error;
  }
}
let running=false;
async function reconcile() {
  if(!enabled() || running) return {skipped:true};
  running=true;
  try {
    schema();
    const rows=db.prepare(`SELECT e.* FROM arcade_entitlements e LEFT JOIN arcade_dino_deliveries d ON d.entitlement_id=e.id
      WHERE e.status='ready' AND (d.entitlement_id IS NULL OR (d.status IN ('waiting','queued','review') AND d.next_attempt<=?))
      ORDER BY COALESCE(d.next_attempt,0),e.created_at LIMIT 50`).all(Date.now());
    let errors=0;
    for(const row of rows) {
      try { await deliver(row); }
      catch(error) { errors++; console.warn('[arcade-dino-delivery]',row.id,error.code||error.message); }
    }
    return {checked:rows.length,errors};
  } finally { running=false; }
}
function start() {
  const timer=setInterval(()=>reconcile().catch(e=>console.warn('[arcade-dino-delivery]',e.message)),15000);
  timer.unref?.();
  return timer;
}
module.exports={enabled,schema,snapshot,buildCommand,deliver,reconcile,start};
