'use strict';
const actions={created:'Listing creation timestamp','latest-update':'Latest recorded listing update','sale-timestamp':'Recorded sale timestamp','cancellation-timestamp':'Recorded cancellation timestamp'};
const statuses=['escrowing','active','reserved','transfer_uncertain','cancelling','cancelled','failed','sold','unknown'];
function projectIncidentPeerMarketplace(raw,query,{start,end,finished}){
 const bad=()=>{throw Error('Peer marketplace context could not be verified.');};
 const stamp=value=>{const at=typeof value==='string'?Date.parse(value):NaN;return Number.isSafeInteger(at)&&at>=0&&new Date(at).toISOString()===value?at:null;};
 const sourceStart=stamp(raw?.windowStart),sourceEnd=stamp(raw?.windowEnd);
 if(raw?.version!==1||raw.scope!=='peer-listing-records'||raw.steamId!==query.steamId||raw.occurredAt!==query.occurredAt||raw.complete!==false||raw.gameDeliveryVerified!==false||raw.currentBuyerAssociationOnly!==true||sourceStart!==start||sourceEnd===null||sourceEnd<start||sourceEnd>Math.min(finished,Date.parse(query.occurredAt)+900000)||typeof raw.truncated!=='boolean'||!Array.isArray(raw.events)||raw.events.length>50)bad();
 const seen=new Set(),events=[];
 for(const row of raw.events){
  if(!row||typeof row.listingId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.listingId)||typeof row.kind!=='string'||!Object.hasOwn(actions,row.kind)||row.id!==row.listingId+':'+row.kind||seen.has(row.id)||!['seller','buyer'].includes(row.role)||row.counterpartyIdentityWithheld!==true)bad();
  seen.add(row.id);const at=stamp(row.at);
  if(at===null||at<start||at>sourceEnd||(row.kind==='latest-update'?!statuses.includes(row.status):row.status!=='recorded')||(['created','cancellation-timestamp'].includes(row.kind)&&row.role!=='seller'))bad();
  if(at<=end)events.push({source:'peer-marketplace',id:row.id,at:row.at,category:'peer marketplace listing',action:actions[row.kind],status:row.status,playerSteamId:query.steamId,reference:row.listingId,participantRole:row.role,counterpartyIdentityWithheld:true,gameDeliveryVerified:false,currentBuyerAssociationOnly:true});
 }
 return {events,truncated:raw.truncated};
}
module.exports={projectIncidentPeerMarketplace};
