const store = require('./automationStore');

const PENDING_STATUSES = new Set(['preparing', 'queued', 'acknowledged', 'unknown']);

function reconcileFinalBodyDropResult(result) {
  if (!result || typeof result !== 'object' || result.source !== 'BodyDrop') return null;

  const id = String(result.id || '').trim();
  if (!id || typeof result.ok !== 'boolean' || typeof result.msg !== 'string') return null;

  const request = store.getRequest(id);
  if (!request || request.kind !== 'bodydrop') return request || null;

  // Final BodyDrop results can arrive after the periodic reconciler has already
  // updated the ledger. Keep terminal state idempotent on duplicate result posts.
  if (!PENDING_STATUSES.has(request.status)) return request;

  return store.updateRequest(id, {
    status: result.ok ? 'confirmed' : 'failed',
    message: result.msg,
    error: result.ok ? null : result.msg,
  });
}

module.exports = {
  reconcileFinalBodyDropResult,
};
