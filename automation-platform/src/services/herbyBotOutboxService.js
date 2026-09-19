const { randomUUID } = require('node:crypto');
const store = require('./automationStore');

const DESTINATIONS = new Set(['announcement', 'alert']);

function configured() {
  return Boolean(String(process.env.HERBYBOT_AUTOMATION_TOKEN || '').trim());
}

function maxAttempts() {
  const value = Number(process.env.HERBYBOT_OUTBOX_MAX_ATTEMPTS || 5);
  return Number.isInteger(value) ? Math.max(1, Math.min(20, value)) : 5;
}

function cleanMessage(value) {
  const message = String(value || '').trim();
  if (!message) throw new Error('HerbyBot message is required');
  if (message.length > 1900) throw new Error('HerbyBot message must be 1900 characters or fewer');
  return message;
}

function validateDestination(value) {
  const destination = String(value || '').trim().toLowerCase();
  if (!DESTINATIONS.has(destination)) throw new Error('HerbyBot destination must be announcement or alert');
  return destination;
}

function validateNonce(value) {
  const nonce = String(value || '').trim();
  if (!nonce) return `herbybot-${randomUUID()}`;
  if (!/^[A-Za-z0-9:_-]{8,128}$/.test(nonce)) throw new Error('Invalid HerbyBot message nonce');
  return nonce;
}

function queueMessage({ destination, message, nonce } = {}) {
  const event = store.createOutboxEvent({
    id: randomUUID(),
    destination: validateDestination(destination),
    message: cleanMessage(message),
    nonce: validateNonce(nonce),
  });
  return event;
}

function queueAnnouncement(message, { nonce } = {}) {
  return queueMessage({ destination: 'announcement', message, nonce });
}

function queueAlert(message, { nonce } = {}) {
  return queueMessage({ destination: 'alert', message, nonce });
}

function claimMessages({ limit = 10, leaseSeconds = 60 } = {}) {
  return store.claimOutboxEvents({ limit, leaseSeconds });
}

function acknowledgeMessage(id) {
  const event = store.acknowledgeOutboxEvent(String(id || '').trim());
  if (!event) throw new Error('HerbyBot outbox event not found');
  return event;
}

function failMessage(id, error) {
  const current = store.getOutboxEvent(String(id || '').trim());
  if (!current) throw new Error('HerbyBot outbox event not found');
  const terminal = Number(current.attempts || 0) >= maxAttempts();
  return store.failOutboxEvent(current.id, error, { terminal });
}

function getState() {
  return {
    configured: configured(),
    maxAttempts: maxAttempts(),
    outbox: store.getOutboxSummary(),
  };
}

module.exports = {
  configured,
  maxAttempts,
  cleanMessage,
  validateDestination,
  validateNonce,
  queueMessage,
  queueAnnouncement,
  queueAlert,
  claimMessages,
  acknowledgeMessage,
  failMessage,
  getState,
};
