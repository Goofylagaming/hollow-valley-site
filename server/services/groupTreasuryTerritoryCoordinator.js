const fail = (code, message, status = 409) => Object.assign(new Error(message), { code, status });
function createGroupTreasuryTerritoryCoordinator(db, groups, client, {
  enabled = () => process.env.GROUP_TREASURY_ENABLED === '1' && process.env.GROUP_TREASURY_SPEND_ENABLED === '1' && process.env.GROUP_TREASURY_TERRITORY_ENABLED === '1'
} = {}) {
  const proof = require('../../automation-platform/src/services/groupTreasuryTerritoryProof');
  const ready = () => enabled() && process.env.TERRITORY_WARS_ADMIN_TEST_ENABLED === '1' && proof.configured(process.env.GROUP_TREASURY_TERRITORY_PROOF_SECRET) && Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE name='territory_events'").get());
  const delivery = require('./groupTreasuryTerritoryDelivery').createGroupTreasuryTerritoryDelivery(db, groups, { read: body => client.status(body) }, { enabled: ready });
  const body = saved => ({ expectedGroupId: saved.groupId, requestId: saved.requestId });
  const request = (actor, saved) => ({ groupId: saved.groupId, requestId: saved.requestId, actorSteamId: actor });
  function owner(actor, saved) {
    const group = groups.getState(actor).current;
    if (!group || group.id !== saved.groupId || group.ownerSteamId !== actor) throw fail('PURCHASE_UNAVAILABLE', 'Group purchase unavailable', 404);
  }
  function local(actor, saved) {
    try { return delivery.read(actor, body(saved)); }
    catch (error) { if (error.code === 'ENTRY_UNAVAILABLE') return null; throw error; }
  }
  async function settle(actor, saved) {
    owner(actor, saved);
    return client.settleTerritory({ ...request(actor, saved), evidence: delivery.signedEvidence(actor, body(saved)) });
  }
  async function finish(actor, saved, remote) {
    owner(actor, saved);
    let outcome = local(actor, saved);
    if (outcome && outcome.outcome !== 'pending') return settle(actor, saved);
    if (!ready()) throw fail('TREASURY_SPENDING_DISABLED', 'New Territory entry is not enabled', 503);
    if (remote.state === 'reserved') {
      outcome = await delivery.prepare(actor, { ...body(saved), binding: saved.fulfillment });
      owner(actor, saved);
      if (outcome.outcome !== 'pending') return settle(actor, saved);
      await client.dispatchTerritory(request(actor, saved));
      owner(actor, saved);
    } else if (remote.state !== 'fulfilling' || !outcome) {
      throw fail('ENTRY_OUTCOME_PENDING', 'The saved dispatch and entry binding require review');
    }
    await delivery.deliver(actor, body(saved));
    owner(actor, saved);
    return settle(actor, saved);
  }
  async function recover(actor, saved, remote) {
    owner(actor, saved);
    if (!remote || ['committed', 'released'].includes(remote.state)) return remote;
    const outcome = local(actor, saved);
    return outcome && outcome.outcome !== 'pending' ? settle(actor, saved) : remote;
  }
  async function cancel(actor, saved, purchasePayload) {
    owner(actor, saved);
    const outcome = delivery.cancelSaved(actor, { ...body(saved), item: saved.item, binding: saved.fulfillment });
    const remote = await client.status({ groupId: saved.groupId, requestId: saved.requestId });
    owner(actor, saved);
    if (!remote) return client.release(purchasePayload);
    if (['committed', 'released'].includes(remote.state)) return remote;
    // A completed registration stays paid even if cancellation arrives later.
    if (!['delivered', 'not_delivered'].includes(outcome.outcome)) throw fail('ENTRY_OUTCOME_PENDING', 'The entry outcome needs review');
    return settle(actor, saved);
  }
  return { ready, finish, recover, cancel, preview: (actor, input) => {
    if (!ready()) throw fail('UNSUPPORTED_FULFILLMENT', 'Territory entry is not enabled', 503);
    return delivery.preview(actor, input);
  } };
}
module.exports = { createGroupTreasuryTerritoryCoordinator };
