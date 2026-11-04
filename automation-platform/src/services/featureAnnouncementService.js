// Admin-published feature news. This queues messages for the existing HerbyBot;
// it does not change game state or claim that a Discord message was delivered.
const outbox = require('./herbyBotOutboxService');
const store = require('./automationStore');

const GROWTH_PRESETS = Object.freeze([1, 2, 3, 4, 5, 10]);
const DESTINATIONS = Object.freeze(['announcement', 'progress']);
const PING_MODES = Object.freeze(['none', 'community', 'everyone']);

function invalid(message, code = 'FEATURE_ANNOUNCEMENT_INVALID') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function validate(payload = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    invalid('A feature announcement is required.');
  }
  if (payload.confirm !== 'ANNOUNCE VERIFIED' || payload.verified !== true) {
    invalid('Confirm the change is already active before publishing.');
  }
  const requestId = String(payload.requestId || '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(requestId)) {
    invalid('A valid announcement request ID is required.');
  }
  const kind = String(payload.kind || '').trim();
  const channels = payload.channels;
  if (!Array.isArray(channels) || !channels.length ||
      channels.length > DESTINATIONS.length || new Set(channels).size !== channels.length ||
      channels.some((channel) => !DESTINATIONS.includes(channel))) {
    invalid('Choose at least one supported Discord destination.');
  }

  // Mass mentions are only permitted for a manually VERIFIED global growth
  // notice in Community Announcements, never for generic event text.
  const pingMode = payload.pingMode == null ? 'none' : String(payload.pingMode).trim();
  if (!PING_MODES.includes(pingMode)) {
    invalid('Choose no ping, Community Member or everyone for growth changes.');
  }
  if (pingMode !== 'none' && (kind !== 'growth' || !channels.includes('announcement'))) {
    invalid('Growth-rate pings require a verified growth announcement in Community Announcements.');
  }

  let message;
  if (kind === 'growth') {
    const multiplier = typeof payload.multiplier === 'number' ? payload.multiplier : NaN;
    if (!GROWTH_PRESETS.includes(multiplier)) invalid('Growth multiplier must be 1, 2, 3, 4, 5, or 10.');
    message = `🦖 Hollow Valley update: Server growth is now ${multiplier}×! Enjoy the faster growth and happy surviving!`;
  } else if (kind === 'custom') {
    message = String(payload.message || '').trim();
    if (!message || message.length > 1800 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(message)) {
      invalid('The announcement must contain 1–1,800 characters without control characters.');
    }
  } else {
    invalid('Choose a supported feature announcement type.');
  }
  return { kind, message, requestId, channels, pingMode };
}

function queueVerifiedAnnouncement(payload) {
  // Unlike the generic outbox, feature announcements fail closed if no
  // HerbyBot connection is configured. Queuing is not equivalent to delivery.
  if (!outbox.configured()) invalid('HerbyBot is not configured for announcements.', 'FEATURE_ANNOUNCEMENT_UNAVAILABLE');
  const announcement = validate(payload);
  // Reserve the complete request before queuing any destination. A changed
  // channel set must not enqueue a new message before detecting a conflict.
  const key = 'feature-announcement:' + announcement.requestId;
  // A request with no ping has the exact historical reservation signature.
  // Old successful requests remain replay-safe across this release.
  const { pingMode, ...legacySignature } = announcement;
  const signature = JSON.stringify({
    ...legacySignature,
    channels: [...announcement.channels].sort(),
    ...(pingMode === 'none' ? {} : { pingMode }),
  });
  const existing = store.getState(key)?.value;
  if (existing) {
    if (existing.signature !== signature) invalid('This announcement ID was already used for different content.', 'FEATURE_ANNOUNCEMENT_CONFLICT');
    if (!existing.result) invalid('This request has an uncertain queue result. Review the outbox before creating another notice.', 'FEATURE_ANNOUNCEMENT_UNAVAILABLE');
    return existing.result;
  }
  // Preserve dedupe for notices queued by the previous release, before the
  // complete-request reservation existed. Inspect every supported destination.
  const noncePrefix = 'hv-feature-' + announcement.requestId.replace(/-/g, '') + '-';
  const nonceFor = destination => noncePrefix + destination +
    (destination === 'announcement' && announcement.kind === 'growth' && pingMode !== 'none'
      ? '-ping-' + pingMode : '');
  // Check both legacy and opt-in scoped pings BEFORE reserving/queueing. This
  // prevents a reused request ID from converting an already sent silent
  // announcement into a second notification.
  const priorNonces = DESTINATIONS.flatMap(destination => destination === 'announcement'
    ? [noncePrefix + destination, noncePrefix + destination + '-ping-community',
       noncePrefix + destination + '-ping-everyone']
    : [noncePrefix + destination]);
  const legacy = priorNonces.map(nonce => store.getOutboxEventByNonce(nonce)).filter(Boolean);
  if (legacy.length && (legacy.length !== announcement.channels.length || legacy.some(event =>
    !announcement.channels.includes(event.destination) ||
    event.nonce !== nonceFor(event.destination) ||
    event.message !== announcement.message))) {
    invalid('This announcement ID was already used for different content.', 'FEATURE_ANNOUNCEMENT_CONFLICT');
  }
  const reservation = store.reserveState(key, { signature, status: 'pending', result: null });
  if (!reservation.inserted) {
    if (reservation.value.signature !== signature) invalid('This announcement ID was already used for different content.', 'FEATURE_ANNOUNCEMENT_CONFLICT');
    if (!reservation.value.result) invalid('This request has an uncertain queue result. Review the outbox before creating another notice.', 'FEATURE_ANNOUNCEMENT_UNAVAILABLE');
    return reservation.value.result;
  }
  const receipts = [];
  for (const destination of announcement.channels) {
    const nonce = nonceFor(destination);
    const event = outbox.queueMessage({ destination, message: announcement.message, nonce });
    if (event.destination !== destination || event.message !== announcement.message) {
      // Same request ID reused for different content. Preserve the first
      // message, never enqueue a conflicting replacement.
      invalid('This announcement ID was already used for different content.', 'FEATURE_ANNOUNCEMENT_CONFLICT');
    }
    receipts.push({ destination, eventId: event.id, state: event.status });
  }
  const result = { queued: true, kind: announcement.kind, message: announcement.message,
    requestId: announcement.requestId, pingMode, receipts, deliveryConfirmed: false };
  store.setState(key, { signature, status: 'queued', result });
  return result;
}

module.exports = { GROWTH_PRESETS, DESTINATIONS, PING_MODES, validate, queueVerifiedAnnouncement };
