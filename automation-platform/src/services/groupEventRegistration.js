const { createHash } = require('node:crypto');
const fail = (code, message, status = 409) => Object.assign(new Error(message), { code, status });
function validateDescriptor(input) {
  const fields=['eventId','guildId','eventName','startTime','endTime','revision'];
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==fields.length||Object.keys(input).some(key=>!fields.includes(key))||
    typeof input.eventId!=='string'||!/^\d{10,24}$/.test(input.eventId)||typeof input.guildId!=='string'||!/^\d{10,24}$/.test(input.guildId)||
    typeof input.eventName!=='string'||!input.eventName.trim()||input.eventName.length>120||/[\x00-\x1f\x7f]/.test(input.eventName)||typeof input.startTime!=='string'||
    !Number.isFinite(Date.parse(input.startTime))||new Date(input.startTime).toISOString()!==input.startTime||
    (input.endTime!==null&&(typeof input.endTime!=='string'||!Number.isFinite(Date.parse(input.endTime))||new Date(input.endTime).toISOString()!==input.endTime||Date.parse(input.endTime)<Date.parse(input.startTime))))throw fail('GROUP_EVENT_CHANGED','The reviewed event details could not be verified');
  const value={eventId:input.eventId,guildId:input.guildId,eventName:input.eventName,startTime:input.startTime,endTime:input.endTime};
  const revision=createHash('sha256').update(JSON.stringify(value)).digest('hex');
  if(input.revision!==revision)throw fail('GROUP_EVENT_CHANGED','The reviewed event details could not be verified');
  return {...value,revision};
}
function createGroupEventRegistration(db, { enabled = () => process.env.GROUP_TREASURY_EVENT_ENABLED === '1', now = Date.now } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS economy_group_event_registrations (
    event_id TEXT NOT NULL,group_id INTEGER NOT NULL,request_id TEXT NOT NULL UNIQUE,
    event_json TEXT NOT NULL,registered_by TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT(datetime('now')),
    PRIMARY KEY(event_id,group_id));
    CREATE TABLE IF NOT EXISTS economy_group_event_registration_audit (
    request_id TEXT PRIMARY KEY,event_id TEXT NOT NULL,group_id INTEGER NOT NULL,actor TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT(datetime('now')));`);
  function writable() { if (!enabled()) throw fail('GROUP_EVENT_DISABLED', 'Group event registration is not enabled', 503); }
  function preview(eventId) {
    writable();
    if (typeof eventId !== 'string' || !/^\d{10,24}$/.test(eventId)) throw fail('GROUP_EVENT_UNAVAILABLE', 'A synced Discord event is required');
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE name='automation_state' AND type='table'").get();
    const row = exists && db.prepare("SELECT value_json FROM automation_state WHERE key='discord:scheduled-events'").get();
    let snapshot; try { snapshot = JSON.parse(row?.value_json); } catch { /* Unknown feed fails closed. */ }
    const timestamp = Date.parse(snapshot?.syncedAt), current = now();
    const configuredSeconds = Number(process.env.DISCORD_EVENTS_STALE_SECONDS || 300);
    const staleMs = Math.max(60, Math.min(3600, Number.isFinite(configuredSeconds) ? configuredSeconds : 300)) * 1000;
    if (!Number.isFinite(timestamp) || timestamp > current + 60000 || current - timestamp > staleMs || !Array.isArray(snapshot?.events) || snapshot.events.length > 250) throw fail('GROUP_EVENT_FEED_UNAVAILABLE', 'A fresh event snapshot is required', 503);
    if (snapshot.hiddenEventIds?.includes(eventId)) throw fail('GROUP_EVENT_UNAVAILABLE', 'This event is not open for group registration');
    const matches = snapshot.events.filter(event => event?.id === eventId);
    const event = matches[0];
    if (matches.length !== 1 || event.status !== 'scheduled' || typeof snapshot.guildId !== 'string' || !/^\d{10,24}$/.test(snapshot.guildId) || event.guildId !== snapshot.guildId || typeof event.title !== 'string' || !event.title.trim() || event.title.length > 120 || /[\x00-\x1f\x7f]/.test(event.title)) throw fail('GROUP_EVENT_UNAVAILABLE', 'The scheduled event could not be verified');
    const starts = Date.parse(event.startTime), ends = event.endTime === null ? null : Date.parse(event.endTime);
    if (!Number.isFinite(starts) || starts <= current || (ends !== null && (!Number.isFinite(ends) || ends < starts))) throw fail('GROUP_EVENT_NOT_OPEN', 'Group registration closes when the event starts');
    const value = { eventId, guildId: event.guildId, eventName: event.title, startTime: new Date(starts).toISOString(), endTime: ends === null ? null : new Date(ends).toISOString() };
    return { ...value, revision: createHash('sha256').update(JSON.stringify(value)).digest('hex') };
  }
  function reviewed(eventId, expected) {
    const actual = preview(eventId);
    // The full canonical event snapshot is consent data; a changed title/time
    // requires reviewing a new request rather than silently retargeting one.
    if (JSON.stringify(validateDescriptor(expected)) !== JSON.stringify(actual)) throw fail('GROUP_EVENT_CHANGED', 'The event changed; review its current details before registering');
    return actual;
  }
  // Caller holds the accounting write transaction. No independent commit is
  // allowed here: registration, audit and the charge must succeed together.
  function fulfill(row, actor) {
    writable();
    if (!db.isTransaction) throw fail('GROUP_EVENT_TRANSACTION_REQUIRED', 'Registration requires the accounting transaction', 500);
    const item = JSON.parse(row.item_json), event = reviewed(item.target.eventId, JSON.parse(row.event_json));
    if (db.prepare('SELECT 1 FROM economy_group_event_registrations WHERE event_id=? AND group_id=?').get(event.eventId, row.group_id)) throw fail('GROUP_EVENT_ALREADY_REGISTERED', 'This group is already registered');
    db.prepare('INSERT INTO economy_group_event_registrations(event_id,group_id,request_id,event_json,registered_by) VALUES(?,?,?,?,?)').run(event.eventId, row.group_id, row.request_key, JSON.stringify(event), actor);
    db.prepare('INSERT INTO economy_group_event_registration_audit(request_id,event_id,group_id,actor) VALUES(?,?,?,?)').run(row.request_key, event.eventId, row.group_id, actor);
  }
  function verify(row) {
    let descriptor,item;try{descriptor=validateDescriptor(JSON.parse(row.event_json));item=JSON.parse(row.item_json);}catch{throw fail('TREASURY_INTEGRITY_ERROR','Group event registration evidence requires review',500);}
    const registration = db.prepare('SELECT * FROM economy_group_event_registrations WHERE request_id=?').get(row.request_key);
    const audit = db.prepare('SELECT * FROM economy_group_event_registration_audit WHERE request_id=?').get(row.request_key);
    const ledger = db.prepare('SELECT group_id,amount,kind FROM economy_group_treasury_ledger WHERE spend_request_id=?').get(row.request_key);
    if (descriptor.eventId!==row.target_key||item.purpose!=='event_registration'||item.target?.eventId!==row.target_key||item.cost!==row.cost||row.state !== 'committed' || !ledger || ledger.group_id !== row.group_id || ledger.amount !== -row.cost || ledger.kind !== 'purchase' || !registration || !audit || registration.group_id !== row.group_id || registration.event_id !== row.target_key || registration.event_json !== row.event_json || audit.event_id !== row.target_key || audit.group_id !== row.group_id || audit.actor !== registration.registered_by) throw fail('TREASURY_INTEGRITY_ERROR', 'Group event registration evidence requires review', 500);
  }
  function list(groupId) {
    if (!Number.isSafeInteger(groupId) || groupId < 1) throw fail('INVALID_GROUP', 'A website group is required', 400);
    return db.prepare("SELECT * FROM economy_group_treasury_spends WHERE group_id=? AND purpose='event_registration' AND event_json IS NOT NULL AND state='committed' ORDER BY rowid DESC LIMIT 50").all(groupId).map(row => {
      verify(row);
      const registration = db.prepare('SELECT created_at FROM economy_group_event_registrations WHERE request_id=?').get(row.request_key);
      return { eventId: row.target_key, event: JSON.parse(row.event_json), requestId: row.request_key, registeredAt: registration.created_at };
    });
  }
  function pageLimit(value){if(!Number.isSafeInteger(value)||value<1||value>100)throw fail('INVALID_PAGE','Choose a page size from 1 to 100',400);return value;}
  function roster(eventId,{afterGroupId=0,limit=50}={}){
    if(typeof eventId!=='string'||!/^\d{10,24}$/.test(eventId)||!Number.isSafeInteger(afterGroupId)||afterGroupId<0)throw fail('INVALID_PAGE','A valid event and group cursor are required',400);
    const rows=db.prepare("SELECT * FROM economy_group_treasury_spends WHERE purpose='event_registration' AND event_json IS NOT NULL AND state='committed' AND target_key=? AND group_id>? ORDER BY group_id LIMIT ?").all(eventId,afterGroupId,pageLimit(limit)+1);
    const page=rows.slice(0,limit).map(row=>{verify(row);const registration=db.prepare('SELECT created_at FROM economy_group_event_registrations WHERE request_id=?').get(row.request_key);
      return {groupId:row.group_id,eventId:row.target_key,event:validateDescriptor(JSON.parse(row.event_json)),cost:row.cost,requestId:row.request_key,registeredAt:registration.created_at};});
    return {eventId,registrations:page,nextGroupId:rows.length>limit?page.at(-1).groupId:null};
  }
  function eventIndex({afterEventId='',limit=50}={}){
    if(typeof afterEventId!=='string'||(afterEventId!==''&&!/^\d{10,24}$/.test(afterEventId)))throw fail('INVALID_PAGE','A valid event cursor is required',400);
    const rows=db.prepare("SELECT target_key,MIN(rowid) AS first_id FROM economy_group_treasury_spends WHERE purpose='event_registration' AND event_json IS NOT NULL AND state='committed' AND target_key>? GROUP BY target_key ORDER BY target_key LIMIT ?").all(afterEventId,pageLimit(limit)+1);
    const page=rows.slice(0,limit).map(row=>{const receipt=db.prepare('SELECT * FROM economy_group_treasury_spends WHERE rowid=?').get(row.first_id);verify(receipt);return validateDescriptor(JSON.parse(receipt.event_json));});
    return {events:page,nextEventId:rows.length>limit?page.at(-1).eventId:null};
  }
  return { enabled, preview, reviewed, fulfill, verify, list, roster, eventIndex };
}
module.exports = { createGroupEventRegistration, validateDescriptor };
