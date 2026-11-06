'use strict';
const {timestamp}=require('./incidentMarketplaceService');
const WINDOW_MS=900000,LIMIT=50;
const STATUSES=['escrowing','active','reserved','transfer_uncertain','cancelling','cancelled','failed','sold'];
function createIncidentPeerMarketplaceSource({db,now=Date.now,enabled=()=>process.env.INCIDENT_PEER_MARKETPLACE_CONTEXT_ENABLED==='1'}={}){
 function read(input){
  const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
  if(!enabled())fail(503,'Peer marketplace context is disabled.');
  const clock=now(),at=timestamp(input?.occurredAt);
  if(!input||Array.isArray(input)||Object.keys(input).some(key=>!['steamId','occurredAt'].includes(key))||typeof input.steamId!=='string'||!/^\d{17}$/.test(input.steamId)||at===null||input.occurredAt!==new Date(at).toISOString()||!Number.isSafeInteger(clock)||clock<WINDOW_MS||clock>8640000000000000-WINDOW_MS||at<WINDOW_MS||at<clock-90*86400000||at>clock+WINDOW_MS)fail(400,'A player and valid incident time are required.');
  const start=at-WINDOW_MS,end=Math.min(clock,at+WINDOW_MS),from=new Date(start).toISOString(),until=new Date(end).toISOString();
  // Creation/cancellation belong to the seller. Current buyer association does
  // not establish that the buyer was involved when the listing was created.
  const rows=db.prepare(`SELECT * FROM (
   SELECT id AS listing_id,created_at AS at,'created' AS kind,'recorded' AS status,'seller' AS role FROM economy_dino_listings
   WHERE seller_steam_id=? AND julianday(created_at)>=julianday(?) AND julianday(created_at)<=julianday(?)
   UNION ALL
   SELECT id,updated_at,'latest-update',status,CASE WHEN seller_steam_id=? THEN 'seller' ELSE 'buyer' END FROM economy_dino_listings
   WHERE (seller_steam_id=? OR buyer_steam_id=?) AND julianday(updated_at)>=julianday(?) AND julianday(updated_at)<=julianday(?)
   UNION ALL
   SELECT id,sold_at,'sale-timestamp','recorded',CASE WHEN seller_steam_id=? THEN 'seller' ELSE 'buyer' END FROM economy_dino_listings
   WHERE (seller_steam_id=? OR buyer_steam_id=?) AND julianday(sold_at)>=julianday(?) AND julianday(sold_at)<=julianday(?)
   UNION ALL
   SELECT id,cancelled_at,'cancellation-timestamp','recorded','seller' FROM economy_dino_listings
   WHERE seller_steam_id=? AND julianday(cancelled_at)>=julianday(?) AND julianday(cancelled_at)<=julianday(?)
  ) ORDER BY julianday(at) DESC,listing_id DESC,kind DESC LIMIT ?`).all(input.steamId,from,until,input.steamId,input.steamId,input.steamId,from,until,input.steamId,input.steamId,input.steamId,from,until,input.steamId,from,until,LIMIT+1);
  let truncated=rows.length>LIMIT;const events=[];
  for(const row of rows.slice(0,LIMIT)){
   const eventAt=timestamp(row.at);
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.listing_id)||eventAt===null||eventAt<start||eventAt>end){truncated=true;continue;}
   events.push({id:row.listing_id+':'+row.kind,listingId:row.listing_id,at:new Date(eventAt).toISOString(),kind:row.kind,role:row.role,status:row.kind==='latest-update'?(STATUSES.includes(row.status)?row.status:'unknown'):'recorded',counterpartyIdentityWithheld:true});
  }
  return {version:1,scope:'peer-listing-records',steamId:input.steamId,occurredAt:input.occurredAt,windowStart:from,windowEnd:until,complete:false,gameDeliveryVerified:false,currentBuyerAssociationOnly:true,truncated,events};
 }
 return {read};
}
module.exports={createIncidentPeerMarketplaceSource,LIMIT};
