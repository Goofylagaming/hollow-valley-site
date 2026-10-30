// Admin-published feature news. This queues messages for the existing HerbyBot;
// it does not change game state or claim that a Discord message was delivered.
const outbox = require('./herbyBotOutboxService');

const GROWTH_PRESETS = Object.freeze([1, 2, 3, 4, 5, 10]);
const DESTINATIONS = Object.freeze(['announcement', 'progress']);

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

  let message;
  if (kind === 'growth') {
    const multiplier = Number(payload.multiplier);
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
  return { kind, message, requestId, channels };
}

function queueVerifiedAnnouncement(payload) {
  // Unlike the generic outbox, feature announcements fail closed if no
  // HerbyBot connection is configured. Queuing is not equivalent to delivery.
  if (!outbox.configured()) invalid('HerbyBot is not configured for announcements.', 'FEATURE_ANNOUNCEMENT_UNAVAILABLE');
  const announcement = validate(payload);
  const receipts = [];
  for (const destination of announcement.channels) {
    const nonce = `hv-feature-${announcement.requestId.replace(/-/g, '')}-${destination}`;
    const event = outbox.queueMessage({ destination, message: announcement.message, nonce });
    if (event.destination !== destination || event.message !== announcement.message) {
      // Same request ID reused for different content. Preserve the first
      // message, never enqueue a conflicting replacement.
      invalid('This announcement ID was already used for different content.', 'FEATURE_ANNOUNCEMENT_CONFLICT');
    }
    receipts.push({ destination, eventId: event.id, state: event.status });
  }
  return { queued: true, kind: announcement.kind, message: announcement.message,
    requestId: announcement.requestId, receipts, deliveryConfirmed: false };
}

module.exports = { GROWTH_PRESETS, DESTINATIONS, validate, queueVerifiedAnnouncement };
