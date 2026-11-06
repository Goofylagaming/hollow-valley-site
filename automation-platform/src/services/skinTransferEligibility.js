'use strict';
// Shared permanent-unlock rules. Call inside the caller's write transaction
// when moving ownership; this check is not a reservation or a public endpoint.
function createSkinTransferEligibility(store){
 const db=store.db,parked=require('./skinParkedApplicationService').createSkinParkedApplicationService(store);
 const fail=message=>{throw Object.assign(new Error(message),{status:409});};
 return function inspect(sender,presetId){
  const preset=store.getSkinPreset(presetId);
  if(!preset?.active||preset.membershipPremium||preset.isPremium||(preset.published&&Number(preset.price)===0)||preset.owner_steam_id===sender||store.hasSkinGrant(sender,presetId))fail('This skin is not transferable');
  if(db.prepare("SELECT 1 FROM economy_skin_apply_jobs WHERE steam_id=? AND preset_id=? AND status IN ('queued','awaiting_confirmation')").get(sender,presetId))fail('Wait for the pending skin application to finish before transferring');
  if(parked.pending(sender,presetId))fail('A parked skin application is awaiting confirmation; check its outcome before transferring');
  const unlock=db.prepare('SELECT * FROM economy_skin_unlocks WHERE steam_id=? AND preset_id=?').get(sender,presetId);
  if(!unlock?.idempotency_key)fail('A permanent skin unlock with a receipt is required');
  return {preset,unlock};
 };
}
module.exports={createSkinTransferEligibility};
