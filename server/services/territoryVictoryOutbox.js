function createVictoryOutbox(db,{send,now=Date.now}={}) {
  db.exec(`CREATE TABLE IF NOT EXISTS territory_victory_outbox (
    attack_id INTEGER PRIMARY KEY,payload_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at INTEGER NOT NULL DEFAULT 0,
    delivered_at INTEGER,last_error_code TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS territory_victory_delivery_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,attack_id INTEGER NOT NULL,actor_steam_id TEXT NOT NULL,
    reason TEXT NOT NULL,previous_status TEXT NOT NULL,reviewed_at INTEGER NOT NULL
  )`);
  let running=false;
  function enqueue(payload) {
    const serialized=JSON.stringify(payload);
    const old=db.prepare('SELECT payload_json FROM territory_victory_outbox WHERE attack_id=?').get(payload.attackId);
    if(old && old.payload_json!==serialized) throw new Error('Victory outbox evidence conflict');
    if(!old) db.prepare('INSERT INTO territory_victory_outbox(attack_id,payload_json) VALUES (?,?)').run(payload.attackId,serialized);
  }
  async function flush() {
    if(running || typeof send!=='function') return;
    running=true;
    try {
      const rows=db.prepare("SELECT * FROM territory_victory_outbox WHERE status='pending' AND next_attempt_at<=? ORDER BY attack_id LIMIT 20").all(now());
      for(const row of rows) {
        try {
          const ack=await send(JSON.parse(row.payload_json));
          if(ack?.accepted!==true || ack.attackId!==row.attack_id) throw new Error('Invalid acknowledgement');
          db.prepare("UPDATE territory_victory_outbox SET status='delivered',attempts=attempts+1,delivered_at=?,last_error_code=NULL WHERE attack_id=? AND status='pending'").run(now(),row.attack_id);
        } catch(error) {
          const status=Number(error.status);
          const review=[400,409,422].includes(status);
          const delay=Math.min(900000,15000*2**Math.min(row.attempts,6));
          db.prepare("UPDATE territory_victory_outbox SET status=?,attempts=attempts+1,next_attempt_at=?,last_error_code=? WHERE attack_id=? AND status='pending'")
            .run(review?'review':'pending',now()+delay,Number.isInteger(status)&&status>=400&&status<=599?`http-${status}`:'delivery-failed',row.attack_id);
        }
      }
    } finally {running=false;}
  }
  function list() {
    return db.prepare(`SELECT attack_id AS attackId,status,attempts,next_attempt_at AS nextAttemptAt,
      delivered_at AS deliveredAt,last_error_code AS errorCode
      FROM territory_victory_outbox ORDER BY CASE status WHEN 'review' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,attack_id DESC LIMIT 100`).all();
  }
  function retry(attackId,actor,reason) {
    if(!Number.isSafeInteger(attackId)||attackId<=0||!/^\d{17}$/.test(actor)||typeof reason!=='string'||reason.trim().length<10||reason.length>500) {
      throw Object.assign(new Error('A valid battle, linked admin and review reason are required'),{status:400});
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      const row=db.prepare('SELECT status FROM territory_victory_outbox WHERE attack_id=?').get(attackId);
      if(!row) throw Object.assign(new Error('Delivery not found'),{status:404});
      if(row.status==='delivered') throw Object.assign(new Error('This result was already delivered'),{status:409});
      db.prepare('INSERT INTO territory_victory_delivery_reviews(attack_id,actor_steam_id,reason,previous_status,reviewed_at) VALUES (?,?,?,?,?)').run(attackId,actor,reason.trim(),row.status,now());
      db.prepare("UPDATE territory_victory_outbox SET status='pending',next_attempt_at=0 WHERE attack_id=?").run(attackId);
      db.exec('COMMIT');return {queued:true,attackId};
    } catch(error) {db.exec('ROLLBACK');throw error;}
  }
  return {enqueue,flush,list,retry};
}
function start() {
  if(process.env.TERRITORY_VICTORY_DELIVERY_ENABLED!=='1') return null;
  const {db}=require('../db');
  const automation=require('./automationWebsiteClient');
  const queue=createVictoryOutbox(db,{send:payload=>automation.postTerritoryVictory(payload)});
  const tick=()=>queue.flush().catch(()=>console.warn('[territory-victory] queue unavailable'));
  tick();const timer=setInterval(tick,15000);timer.unref?.();return timer;
}
module.exports={createVictoryOutbox,start};
