'use strict';
const MAX_ITEMS=1000,MAX_PAYLOAD_BYTES=16384,MAX_TOTAL_BYTES=2*1024*1024;
// This source never initializes tables, seeds a catalog or touches customer data.
function readMarketplaceHealth(db,{now=Date.now}={}){
 const at=now(),validClock=Number.isSafeInteger(at)&&at>=0&&at<=8640000000000000;
 const base={version:1,scope:'official-catalog-read',code:'unavailable',observedAt:validClock?new Date(at).toISOString():null,checkoutVerified:false,fulfillmentVerified:false};
 if(!validClock)return {...base,code:'unverified-clock'};
 try{
  const rows=db.prepare(`SELECT id,item_type,name,price,
   length(CAST(payload_json AS BLOB)) payload_bytes,
   substr(payload_json,1,?) payload_json
   FROM economy_marketplace_catalog WHERE active=1 ORDER BY id LIMIT ?`).all(MAX_PAYLOAD_BYTES+1,MAX_ITEMS+1);
  if(rows.length>MAX_ITEMS)return {...base,code:'catalog-too-large'};
  if(!rows.length)return {...base,code:'empty-catalog'};
  let total=0;
  for(const row of rows){
   if(!Number.isSafeInteger(row.payload_bytes)||row.payload_bytes<0)return {...base,code:'invalid-catalog'};
   if(row.payload_bytes>MAX_PAYLOAD_BYTES||(total+=row.payload_bytes)>MAX_TOTAL_BYTES)return {...base,code:'catalog-too-large'};
   if(typeof row.id!=='string'||!row.id.trim()||typeof row.name!=='string'||!row.name.trim()||typeof row.item_type!=='string'||!row.item_type.trim()||!Number.isSafeInteger(row.price)||row.price<=0)return {...base,code:'invalid-catalog'};
   let payload;try{payload=JSON.parse(row.payload_json);}catch{return {...base,code:'invalid-catalog'};}
   if(!payload||typeof payload!=='object'||Array.isArray(payload))return {...base,code:'invalid-catalog'};
  }
  return {...base,code:'readable'};
 }catch{return base;}
}
module.exports={readMarketplaceHealth,MAX_ITEMS,MAX_PAYLOAD_BYTES,MAX_TOTAL_BYTES};
