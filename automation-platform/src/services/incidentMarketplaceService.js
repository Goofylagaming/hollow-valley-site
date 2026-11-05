'use strict';
const WINDOW_MS = 900000, LIMIT = 50;
const timestamp = value => {
  if (typeof value !== 'string') return null;
  const canonical = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value) ? value.replace(' ','T')+'.000Z' : value;
  const at = Date.parse(canonical);
  return Number.isSafeInteger(at) && at >= 0 && new Date(at).toISOString() === canonical ? at : null;
};
function createIncidentMarketplaceSource({db, now = Date.now, enabled = () => process.env.INCIDENT_MARKETPLACE_CONTEXT_ENABLED === '1'} = {}) {
  function read(input) {
    const fail = (status,message) => {throw Object.assign(Error(message),{status});};
    if (!enabled()) fail(503,'Marketplace incident context is disabled.');
    const clock = now(), at = timestamp(input?.occurredAt);
    if (!input || Array.isArray(input) || Object.keys(input).some(key => !['steamId','occurredAt'].includes(key)) || !/^\d{17}$/.test(input.steamId || '') || typeof input.steamId !== 'string' || at === null || input.occurredAt !== new Date(at).toISOString() || !Number.isSafeInteger(clock) || clock < WINDOW_MS || clock > 8640000000000000-WINDOW_MS || at < WINDOW_MS || at < clock-90*86400000 || at > clock+WINDOW_MS) fail(400,'A player and valid incident time are required.');
    const start=at-WINDOW_MS,end=Math.min(clock,at+WINDOW_MS),from=new Date(start).toISOString(),until=new Date(end).toISOString();
    // Only order identifiers, stored timestamps and the latest stored status are read.
    // No economy store initialization, catalog seeding, JSON payloads or mutators.
    const rows=db.prepare(`SELECT * FROM (
      SELECT id AS order_id,created_at AS at,'created' AS kind,'recorded' AS status FROM economy_marketplace_orders
      WHERE steam_id=? AND julianday(created_at)>=julianday(?) AND julianday(created_at)<=julianday(?)
      UNION ALL
      SELECT id,updated_at,'latest-update',status FROM economy_marketplace_orders
      WHERE steam_id=? AND julianday(updated_at)>=julianday(?) AND julianday(updated_at)<=julianday(?)
      UNION ALL
      SELECT id,fulfilled_at,'fulfillment-timestamp','recorded' FROM economy_marketplace_orders
      WHERE steam_id=? AND julianday(fulfilled_at)>=julianday(?) AND julianday(fulfilled_at)<=julianday(?)
    ) ORDER BY julianday(at) DESC,order_id DESC,kind DESC LIMIT ?`).all(input.steamId,from,until,input.steamId,from,until,input.steamId,from,until,LIMIT+1);
    let truncated=rows.length>LIMIT;const events=[];
    for (const row of rows.slice(0,LIMIT)) {
      const eventAt=timestamp(row.at);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.order_id) || eventAt===null || eventAt<start || eventAt>end) {truncated=true;continue;}
      events.push({id:row.order_id+':'+row.kind,orderId:row.order_id,at:new Date(eventAt).toISOString(),kind:row.kind,status:row.kind==='latest-update'?(['pending','fulfilled','failed','refunded'].includes(row.status)?row.status:'unknown'):'recorded'});
    }
    return {version:1,scope:'official-order-records',steamId:input.steamId,occurredAt:input.occurredAt,windowStart:from,windowEnd:until,complete:false,gameDeliveryVerified:false,truncated,events};
  }
  return {read};
}
module.exports={createIncidentMarketplaceSource,timestamp,LIMIT};
