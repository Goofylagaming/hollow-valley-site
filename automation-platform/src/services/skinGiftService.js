const {randomUUID,createHash}=require('node:crypto');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
function createSkinGiftService(store,{now=Date.now,enabled=()=>process.env.SKIN_GIFTING_ENABLED==='1'&&process.env.SKIN_SYSTEM_ENABLED==='true'}={}) {
  const db=store.db;
  const parked=require('./skinParkedApplicationService').createSkinParkedApplicationService(store);
  const live=require('./skinGiftLiveRecovery').createSkinGiftLiveRecovery(store);
  const transferable=require('./skinTransferEligibility').createSkinTransferEligibility(store);
  db.exec(`CREATE TABLE IF NOT EXISTS economy_skin_gifts (
    id TEXT PRIMARY KEY,sender TEXT NOT NULL,recipient TEXT NOT NULL,preset_id TEXT NOT NULL,
    request_id TEXT NOT NULL,payload TEXT NOT NULL,unlock_key TEXT NOT NULL,fingerprint TEXT NOT NULL,
    created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,state TEXT NOT NULL DEFAULT 'pending',
    decided_at INTEGER,UNIQUE(sender,request_id));
    CREATE UNIQUE INDEX IF NOT EXISTS economy_skin_gift_pending ON economy_skin_gifts(sender,preset_id) WHERE state='pending';
    CREATE TABLE IF NOT EXISTS economy_skin_gift_decisions (
    gift_id TEXT PRIMARY KEY,actor TEXT NOT NULL,decision TEXT NOT NULL,receipt TEXT,created_at INTEGER NOT NULL);`);
  const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
  const gate=()=>{if(!enabled())fail('Skin gifting is not enabled',503);};
  const fingerprint=p=>createHash('sha256').update(JSON.stringify([p.owner_steam_id,p.species,p.skin])).digest('hex');
  function offer(user,{recipientSteamId,presetId,requestId,note=''}={}) {
    gate();const sender=store.validateSteamId(user?.steam_id),recipient=store.validateSteamId(recipientSteamId);
    if(sender===recipient||typeof requestId!=='string'||!/^[\w-]{8,128}$/.test(requestId)||typeof note!=='string'||note.length>240)fail('Choose another recipient and a valid gift request');
    const payload=JSON.stringify({recipient,presetId,note:note.trim()});
    return tx(()=>{
      const old=db.prepare('SELECT * FROM economy_skin_gifts WHERE sender=? AND request_id=?').get(sender,requestId);
      if(old){if(old.payload!==payload)fail('Conflicting gift request',409);return {id:old.id,duplicate:true};}
      const {preset,unlock}=transferable(sender,presetId);
      if(preset.owner_steam_id===recipient||store.hasSkinUnlock(recipient,presetId)||store.hasSkinGrant(recipient,presetId))fail('The recipient already has this skin',409);
      db.prepare("UPDATE economy_skin_gifts SET state='expired',decided_at=? WHERE sender=? AND state='pending' AND expires_at<=?").run(now(),sender,now());
      if(db.prepare("SELECT 1 FROM economy_skin_gifts WHERE sender=? AND preset_id=? AND state='pending'").get(sender,presetId))fail('This skin already has a pending gift',409);
      if(db.prepare('SELECT COUNT(*) n FROM economy_skin_gifts WHERE sender=? AND created_at>?').get(sender,now()-86400000).n>=10)fail('You can offer up to ten gifts per day',429);
      const id=randomUUID();
      db.prepare('INSERT INTO economy_skin_gifts(id,sender,recipient,preset_id,request_id,payload,unlock_key,fingerprint,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(id,sender,recipient,presetId,requestId,payload,unlock.idempotency_key,fingerprint(preset),now(),now()+7*86400000);
      return {id,duplicate:false};
    });
  }
  function decide(user,{id,decision,expectedRevision}={}) {
    gate();const actor=store.validateSteamId(user?.steam_id);
    if(!['accepted','declined','cancelled'].includes(decision)||expectedRevision!==0)fail('Valid gift decision and original revision required',409);
    return tx(()=>{
      const row=db.prepare('SELECT * FROM economy_skin_gifts WHERE id=?').get(id);
      if(!row||(decision==='cancelled'?row.sender:row.recipient)!==actor)fail('Gift not found',404);
      if(row.state===decision)return {duplicate:true};
      if(row.state!=='pending'||row.expires_at<=now())fail('This gift is no longer pending',409);
      let receipt=null;
      if(decision==='accepted'){
        const {preset,unlock}=transferable(row.sender,row.preset_id);
        if(unlock.idempotency_key!==row.unlock_key||fingerprint(preset)!==row.fingerprint)fail('The skin or its ownership changed; request a new gift',409);
        if(preset.owner_steam_id===actor||store.hasSkinUnlock(actor,preset.id)||store.hasSkinGrant(actor,preset.id))fail('You already have this skin',409);
        receipt=JSON.stringify(unlock);store.ensureWallet(actor);
        db.prepare('UPDATE economy_skin_unlocks SET steam_id=? WHERE steam_id=? AND preset_id=?').run(actor,row.sender,preset.id);
      }
      db.prepare('UPDATE economy_skin_gifts SET state=?,decided_at=? WHERE id=?').run(decision,now(),id);
      db.prepare('INSERT INTO economy_skin_gift_decisions VALUES (?,?,?,?,?)').run(id,actor,decision,receipt,now());
      return {duplicate:false};
    });
  }
  function list(user) {
    gate();const steam=store.validateSteamId(user?.steam_id);
    return {gifts:db.prepare('SELECT * FROM economy_skin_gifts WHERE sender=? OR recipient=? ORDER BY created_at DESC,rowid DESC LIMIT 100').all(steam,steam).map(row=>{
      const preset=store.getSkinPreset(row.preset_id),state=row.state==='pending'&&row.expires_at<=now()?'expired':row.state;
      return {id:row.id,presetId:row.preset_id,name:preset?.name||'Unavailable skin',sender:row.sender,recipient:row.recipient,note:JSON.parse(row.payload).note,createdAt:row.created_at,expiresAt:row.expires_at,state,revision:state==='pending'?0:1};
    })};
  }
  function eligible(user) {
    gate();const steam=store.validateSteamId(user?.steam_id);
    const rows=db.prepare(`SELECT u.preset_id FROM economy_skin_unlocks u WHERE u.steam_id=?
      AND NOT EXISTS (SELECT 1 FROM economy_skin_gifts g WHERE g.sender=u.steam_id AND g.preset_id=u.preset_id AND g.state='pending' AND g.expires_at>?)
      ORDER BY u.unlocked_at DESC,u.preset_id LIMIT 501`).all(steam,now());
    const skins=[];
    for(const row of rows.slice(0,500)){
      try{const {preset}=transferable(steam,row.preset_id);skins.push({id:preset.id,name:preset.name,species:preset.species});}
      catch(e){if(e.status!==409)throw e;}
    }
    return {skins,limited:rows.length>500};
  }
  return {offer,decide,list,eligible,reconcile:async(user,options={})=>{
    gate();const steam=store.validateSteamId(user?.steam_id);
    const parkedCursor=options.parkedCursor??0;
    if(!Number.isSafeInteger(parkedCursor)||parkedCursor<0)fail('Invalid parked application cursor');
    const liveResult=await live.reconcile(steam,options),parkedResult=await parked.reconcile(steam,{cursor:parkedCursor});
    return {checked:liveResult.checked+parkedResult.checked,resolved:liveResult.resolved+parkedResult.resolved,
      pending:liveResult.pending+parkedResult.pending,nextCursor:liveResult.nextCursor,nextParkedCursor:parkedResult.nextCursor};
  }};
}
module.exports={createSkinGiftService};
