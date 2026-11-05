const { randomUUID } = require('node:crypto');
const { validateItem } = require('../../automation-platform/src/services/groupTreasuryCatalog');
const fail = (code, message, status = 409) => Object.assign(new Error(message), { code, status });

// Internal delivery adapter only. The future spending coordinator must record
// dispatch before calling deliver and verify this database's final evidence
// before accounting commits. No browser-supplied reservation/proof is accepted.
function createGroupTreasuryTerritoryDelivery(db, groups, accounting, { enabled = () => false, proofSecret = () => process.env.GROUP_TREASURY_TERRITORY_PROOF_SECRET } = {}) {
  const links = require('./groupTerritoryLinks').createGroupTerritoryLinks(db, groups);
  const lifecycle = require('./groupTreasuryLifecycle').createGroupTreasuryLifecycle(db);
  db.exec(`CREATE TABLE IF NOT EXISTS hv_treasury_territory_delivery (
    request_id TEXT PRIMARY KEY,proof_id TEXT NOT NULL UNIQUE,group_id INTEGER NOT NULL,
    territory_group_id INTEGER NOT NULL,link_revision INTEGER NOT NULL,event_id INTEGER NOT NULL,
    item_json TEXT NOT NULL,created_by TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK(outcome IN('pending','delivered','not_delivered')),
    reason TEXT,created_at TEXT NOT NULL DEFAULT(datetime('now')),resolved_at TEXT);
    CREATE TABLE IF NOT EXISTS hv_treasury_territory_delivery_audit (
    id INTEGER PRIMARY KEY,request_id TEXT NOT NULL,actor TEXT NOT NULL,outcome TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT(datetime('now')));`);
  function atomic(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function owner(actor, groupId) {
    if (!/^\d{17}$/.test(actor) || !Number.isSafeInteger(groupId) || groupId < 1) throw fail('INVALID_ENTRY_REQUEST', 'A linked owner and website group are required', 400);
    const group = groups.getState(actor).current;
    if (!group || group.id !== groupId) throw fail('ENTRY_UNAVAILABLE', 'Group entry unavailable', 404);
    if (group.ownerSteamId !== actor) throw fail('GROUP_OWNER_REQUIRED', 'Only the current owner can manage this entry', 403);
    return group;
  }
  function key(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(value)) throw fail('INVALID_ENTRY_REQUEST', 'A saved purchase request is required', 400); return value; }
  function read(actor, groupId, requestId) {
    owner(actor, groupId); key(requestId);
    const row = db.prepare('SELECT * FROM hv_treasury_territory_delivery WHERE request_id=? AND group_id=?').get(requestId, groupId);
    if (!row) throw fail('ENTRY_UNAVAILABLE', 'Saved entry unavailable', 404);
    return row;
  }
  function project(row) {
    const item = JSON.parse(row.item_json);
    return { requestId: row.request_id, groupId: row.group_id, territoryGroupId: row.territory_group_id,
      eventId: row.event_id, linkRevision: row.link_revision, outcome: row.outcome, reason: row.reason,
      evidence: row.outcome === 'pending' ? null : { id: row.proof_id, requestId: row.request_id, groupId: row.group_id,
        cost: item.cost, purpose: item.purpose, targetKey: String(row.event_id), outcome: row.outcome } };
  }
  function audit(requestId, actor, outcome) { db.prepare('INSERT INTO hv_treasury_territory_delivery_audit(request_id,actor,outcome) VALUES(?,?,?)').run(requestId, actor, outcome); }
  function finish(row, actor, outcome, reason) {
    db.prepare("UPDATE hv_treasury_territory_delivery SET outcome=?,reason=?,resolved_at=datetime('now') WHERE request_id=?").run(outcome, reason, row.request_id);
    audit(row.request_id, actor, outcome); return project(read(actor, row.group_id, row.request_id));
  }
  async function reservation(actor, groupId, requestId, states) {
    owner(actor, groupId); key(requestId);
    if (typeof accounting?.read !== 'function') throw fail('ENTRY_ACCOUNTING_UNAVAILABLE', 'Trusted accounting status is required', 503);
    const remote = await accounting.read({ groupId, requestId });
    owner(actor, groupId);
    let item;
    try { item = validateItem(remote?.item); } catch { throw fail('ENTRY_RESERVATION_MISMATCH', 'Entry reservation could not be verified', 502); }
    if (remote?.groupId !== groupId || remote?.requestId !== requestId || item.purpose !== 'territory_entry' || !states.includes(remote.state)) throw fail('ENTRY_RESERVATION_MISMATCH', 'Entry reservation could not be verified', 502);
    return item;
  }
  function activeLink(actor, groupId) {
    const link = links.get(actor);
    if (link.groupId !== groupId || !link.active || !link.territoryGroupId) throw fail('ENTRY_LINK_REQUIRED', 'Review an active Territory group link before entry');
    // Link ownership alone is not Territory membership/leadership permission.
    const user = db.prepare(`SELECT u.id FROM users u JOIN territory_group_members m ON m.user_id=u.id
      JOIN territory_groups g ON g.id=m.group_id WHERE u.steam_id=? AND m.group_id=? AND m.role='leader' AND g.leader_user_id=u.id`).get(actor, link.territoryGroupId);
    if (!user) throw fail('ENTRY_LEADER_REQUIRED', 'Lead and belong to the linked Territory group before entry', 403);
    return { ...link, userId: user.id };
  }
  function availableEvent(eventId, territoryGroupId) {
    const event = db.prepare('SELECT id,status,live_test_mode FROM territory_events WHERE id=?').get(eventId);
    if (!event || !['scheduled', 'live', 'paused'].includes(event.status)) throw fail('ENTRY_EVENT_UNAVAILABLE', 'The Territory event is not open for entry');
    if (event.live_test_mode && !db.prepare('SELECT 1 FROM territory_live_test_groups WHERE event_id=? AND group_id=?').get(eventId, territoryGroupId)) throw fail('ENTRY_TEST_RESTRICTED', 'The linked group is not allowed in this controlled test', 403);
  }
  function preview(actor, { expectedGroupId, item } = {}) {
    owner(actor, expectedGroupId); const value = validateItem(item);
    if (value.purpose !== 'territory_entry') throw fail('INVALID_ENTRY_REQUEST', 'A Territory entry item is required', 400);
    const link = activeLink(actor, expectedGroupId); availableEvent(value.target.eventId, link.territoryGroupId);
    return { territoryGroupId: link.territoryGroupId, linkRevision: link.revision, eventId: value.target.eventId,
      territoryGroupName: db.prepare('SELECT name FROM territory_groups WHERE id=?').get(link.territoryGroupId).name,
      eventName: db.prepare('SELECT name FROM territory_events WHERE id=?').get(value.target.eventId).name };
  }
  async function prepare(actor, { expectedGroupId, requestId, binding } = {}) {
    if (!enabled()) throw fail('ENTRY_DELIVERY_DISABLED', 'Treasury Territory delivery is not enabled', 503);
    const item = await reservation(actor, expectedGroupId, requestId, ['reserved']);
    return atomic(() => {
      owner(actor, expectedGroupId); lifecycle.assertOpen(expectedGroupId);
      if (!enabled()) throw fail('ENTRY_DELIVERY_DISABLED', 'Treasury Territory delivery is not enabled', 503);
      const old = db.prepare('SELECT * FROM hv_treasury_territory_delivery WHERE request_id=?').get(requestId);
      if (old) {
        if (old.group_id !== expectedGroupId || old.item_json !== JSON.stringify(item)) throw fail('ENTRY_REQUEST_CONFLICT', 'Saved entry has different details');
        return project(old);
      }
      const link = activeLink(actor, expectedGroupId); availableEvent(item.target.eventId, link.territoryGroupId);
      if (binding && (binding.territoryGroupId !== link.territoryGroupId || binding.linkRevision !== link.revision || binding.eventId !== item.target.eventId)) throw fail('ENTRY_LINK_CHANGED', 'The reviewed Territory entry changed; resolve this saved request');
      db.prepare(`INSERT INTO hv_treasury_territory_delivery(request_id,proof_id,group_id,territory_group_id,link_revision,event_id,item_json,created_by,outcome)
        VALUES(?,?,?,?,?,?,?,?,'pending')`).run(requestId, randomUUID(), expectedGroupId, link.territoryGroupId, link.revision, item.target.eventId, JSON.stringify(item), actor);
      audit(requestId, actor, 'pending'); return project(read(actor, expectedGroupId, requestId));
    });
  }
  async function deliver(actor, { expectedGroupId, requestId } = {}) {
    const saved = read(actor, expectedGroupId, requestId);
    // A terminal database outcome never repeats registration, including while
    // disabled, after a lost reply or after leadership/links change.
    if (saved.outcome !== 'pending') return project(saved);
    if (!enabled()) throw fail('ENTRY_DELIVERY_DISABLED', 'Treasury Territory delivery is not enabled', 503);
    const item = await reservation(actor, expectedGroupId, requestId, ['fulfilling']);
    return atomic(() => {
      const row = read(actor, expectedGroupId, requestId);
      if (row.item_json !== JSON.stringify(item)) throw fail('ENTRY_RESERVATION_MISMATCH', 'Entry reservation details changed', 502);
      if (row.outcome !== 'pending') return project(row);
      if (!enabled()) throw fail('ENTRY_DELIVERY_DISABLED', 'Treasury Territory delivery is not enabled', 503);
      lifecycle.assertOpen(expectedGroupId);
      const link = activeLink(actor, expectedGroupId);
      if (link.territoryGroupId !== row.territory_group_id || link.revision !== row.link_revision) throw fail('ENTRY_LINK_CHANGED', 'The saved Territory link changed; resolve the existing request');
      availableEvent(row.event_id, row.territory_group_id);
      if (db.prepare('SELECT 1 FROM territory_event_registrations WHERE event_id=? AND group_id=?').get(row.event_id, row.territory_group_id)) return finish(row, actor, 'not_delivered', 'ALREADY_REGISTERED');
      db.prepare("INSERT INTO territory_event_registrations(event_id,group_id,registered_by_user_id,status) VALUES(?,?,?,'registered')").run(row.event_id, row.territory_group_id, link.userId);
      const groupName = db.prepare('SELECT name FROM territory_groups WHERE id=?').get(row.territory_group_id).name;
      db.prepare("INSERT INTO territory_event_log(event_id,kind,message,actor_user_id) VALUES(?,'registration',?,?)").run(row.event_id, `${groupName} registered through Treasury`, link.userId);
      return finish(row, actor, 'delivered', null);
    });
  }
  function cancel(actor, { expectedGroupId, requestId } = {}) {
    return atomic(() => { const row = read(actor, expectedGroupId, requestId); return row.outcome === 'pending' ? finish(row, actor, 'not_delivered', 'CANCELLED_BEFORE_DELIVERY') : project(row); });
  }
  function cancelSaved(actor, { expectedGroupId, requestId, item, binding } = {}) {
    const value = validateItem(item); key(requestId);
    if (value.purpose !== 'territory_entry' || !binding || !Number.isSafeInteger(binding.territoryGroupId) || binding.territoryGroupId < 1 || !Number.isSafeInteger(binding.linkRevision) || binding.linkRevision < 1 || binding.eventId !== value.target.eventId) throw fail('INVALID_ENTRY_REQUEST', 'Saved Territory entry details are required', 400);
    return atomic(() => {
      owner(actor, expectedGroupId);
      const old = db.prepare('SELECT * FROM hv_treasury_territory_delivery WHERE request_id=?').get(requestId);
      if (old) {
        if (old.group_id !== expectedGroupId || old.item_json !== JSON.stringify(value) || old.territory_group_id !== binding.territoryGroupId || old.link_revision !== binding.linkRevision) throw fail('ENTRY_REQUEST_CONFLICT', 'Saved entry has different details');
        return old.outcome === 'pending' ? finish(old, actor, 'not_delivered', 'CANCELLED_BEFORE_DELIVERY') : project(old);
      }
      // A cancellation may overtake reservation/preparation. Keep its binding
      // and terminal outcome before any remote call so late work cannot deliver.
      db.prepare(`INSERT INTO hv_treasury_territory_delivery(request_id,proof_id,group_id,territory_group_id,link_revision,event_id,item_json,created_by,outcome,reason,resolved_at)
        VALUES(?,?,?,?,?,?,?,?,'not_delivered','CANCELLED_BEFORE_DELIVERY',datetime('now'))`).run(requestId, randomUUID(), expectedGroupId, binding.territoryGroupId, binding.linkRevision, binding.eventId, JSON.stringify(value), actor);
      audit(requestId, actor, 'not_delivered'); return project(read(actor, expectedGroupId, requestId));
    });
  }
  function signedEvidence(actor, { expectedGroupId, requestId } = {}) {
    return atomic(() => {
      const row = read(actor, expectedGroupId, requestId);
      if (row.outcome === 'pending') throw fail('ENTRY_OUTCOME_PENDING', 'Final entry outcome is not recorded');
      const events = db.prepare("SELECT actor,outcome FROM hv_treasury_territory_delivery_audit WHERE request_id=? AND outcome<>'pending'").all(requestId);
      if (events.length !== 1 || events[0].outcome !== row.outcome) throw fail('ENTRY_EVIDENCE_INCOMPLETE', 'Final entry audit requires review', 500);
      if (row.outcome === 'delivered') {
        const registration = db.prepare(`SELECT r.status,u.steam_id FROM territory_event_registrations r
          JOIN users u ON u.id=r.registered_by_user_id WHERE r.event_id=? AND r.group_id=?`).get(row.event_id, row.territory_group_id);
        if (registration?.status !== 'registered' || registration.steam_id !== events[0].actor) throw fail('ENTRY_EVIDENCE_INCOMPLETE', 'Recorded entry requires review', 500);
      }
      const proof = require('../../automation-platform/src/services/groupTreasuryTerritoryProof');
      if (!proof.configured(proofSecret())) throw fail('ENTRY_PROOF_NOT_CONFIGURED', 'Territory evidence signing is not configured', 503);
      return proof.sign(project(row).evidence, proofSecret());
    });
  }
  return { preview, prepare, deliver, cancel, cancelSaved, signedEvidence, read: (actor, { expectedGroupId, requestId } = {}) => project(read(actor, expectedGroupId, requestId)) };
}
module.exports = { createGroupTreasuryTerritoryDelivery };
