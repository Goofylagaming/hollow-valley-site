// Reconcile original request IDs only. Never publish a replacement command.
function createSkinGiftLiveRecovery(store, {readOutcome=command=>require('./commandBridgeService').readOutcome(command)}={}) {
  async function reconcile(steamId,{cursor=0}={}) {
    const steam=store.validateSteamId(steamId);
    if(!Number.isSafeInteger(cursor)||cursor<0)throw Object.assign(new Error('Invalid application cursor'),{status:400});
    const rows=store.db.prepare(`SELECT rowid AS cursor,id FROM economy_skin_apply_jobs
      WHERE steam_id=? AND status IN ('queued','awaiting_confirmation') AND rowid>?
      ORDER BY rowid LIMIT 11`).all(steam,cursor);
    let resolved=0;
    for(const row of rows.slice(0,10)) {
      let outcome;
      try {outcome=await readOutcome({id:row.id,steam,verb:'skin_apply'});} catch {continue;}
      if(!['confirmed','failed'].includes(outcome?.state))continue;
      // Recheck after the asynchronous read. A concurrent reconciliation may
      // already have resolved or dismissed the job.
      store.db.exec('BEGIN IMMEDIATE');
      try {
        const job=store.getSkinApplyJob(row.id);
        if(!['queued','awaiting_confirmation'].includes(job?.status)){store.db.exec('COMMIT');continue;}
        store.updateSkinApplyJob({id:job.id,status:outcome.state==='confirmed'?'verified':'failed',completed:true,
          error:outcome.state==='failed'?(outcome.message||'SkinStudio rejected the skin'):null});
        // Resolving historical holds must not replace a newer live assignment.
        if(outcome.state==='confirmed'&&store.getLatestSkinApplyJob(steam)?.id===job.id) {
          store.upsertSkinLiveAssignment({steamId:steam,presetId:job.preset_id,species:job.species,
            skin:job.skin,lifeMarker:job.lifeMarker,requestId:job.id,status:'verified',source:'wear_live'});
        }
        store.db.exec('COMMIT');resolved++;
      } catch(error) {store.db.exec('ROLLBACK');throw error;}
    }
    const pending=store.db.prepare("SELECT COUNT(*) n FROM economy_skin_apply_jobs WHERE steam_id=? AND status IN ('queued','awaiting_confirmation')").get(steam).n;
    return {checked:Math.min(rows.length,10),resolved,pending,nextCursor:rows.length>10?rows[9].cursor:null};
  }
  return {reconcile};
}
module.exports={createSkinGiftLiveRecovery};
