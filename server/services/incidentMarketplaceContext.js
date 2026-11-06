'use strict';
const actions={created:'Order creation timestamp','latest-update':'Latest recorded order update','fulfillment-timestamp':'Recorded fulfillment timestamp'};
function projectIncidentMarketplace(raw,query,{start,end,finished}) {
  const bad=()=>{throw Error('Marketplace context could not be verified.');};
  const stamp=value=>{const at=typeof value==='string'?Date.parse(value):NaN;return Number.isSafeInteger(at)&&at>=0&&new Date(at).toISOString()===value?at:null;};
  const sourceStart=stamp(raw?.windowStart),sourceEnd=stamp(raw?.windowEnd);
  if(raw?.version!==1||raw.scope!=='official-order-records'||raw.steamId!==query.steamId||raw.occurredAt!==query.occurredAt||raw.complete!==false||raw.gameDeliveryVerified!==false||sourceStart!==start||sourceEnd===null||sourceEnd<start||sourceEnd>Math.min(finished,Date.parse(query.occurredAt)+900000)||typeof raw.truncated!=='boolean'||!Array.isArray(raw.events)||raw.events.length>50)bad();
  const seen=new Set(),events=[];
  for(const row of raw.events){
    if(!row||typeof row.orderId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.orderId)||typeof row.kind!=='string'||!Object.hasOwn(actions,row.kind)||row.id!==row.orderId+':'+row.kind||seen.has(row.id))bad();
    seen.add(row.id);const at=stamp(row.at);
    if(at===null||at<start||at>sourceEnd||(row.kind==='latest-update'?!['pending','fulfilled','failed','refunded','unknown'].includes(row.status):row.status!=='recorded'))bad();
    if(at<=end)events.push({source:'marketplace',id:row.id,at:row.at,category:'official marketplace order',action:actions[row.kind],status:row.status,playerSteamId:query.steamId,reference:row.orderId,gameDeliveryVerified:false});
  }
  return {events,truncated:raw.truncated};
}
module.exports={projectIncidentMarketplace};
