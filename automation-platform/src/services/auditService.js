const { randomUUID } = require('node:crypto');
const store = require('./automationStore');

const SENSITIVE_KEYS = /token|password|secret|authorization|cookie|credential/i;

function sanitize(value, depth = 0) {
  if (depth > 4) return '[truncated]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > 300 ? `${value.slice(0, 297)}...` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => sanitize(entry, depth + 1));
  if (typeof value === 'object') {
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = SENSITIVE_KEYS.test(key) ? '[redacted]' : sanitize(entry, depth + 1);
    }
    return output;
  }
  return String(value);
}

function begin(category, action, details = {}) {
  return store.createAudit({
    id: randomUUID(),
    category: String(category || 'operator'),
    action: String(action || 'unknown'),
    status: 'started',
    details: sanitize(details),
  });
}

function succeed(entryOrId, details = {}, message = null) {
  const id = typeof entryOrId === 'string' ? entryOrId : entryOrId?.id;
  if (!id) return null;
  const current = store.getAudit(id);
  return store.updateAudit(id, {
    status: 'succeeded',
    details: sanitize({ ...(current?.details || {}), ...details }),
    message: message === null ? null : String(message).slice(0, 500),
  });
}

function fail(entryOrId, error, details = {}) {
  const id = typeof entryOrId === 'string' ? entryOrId : entryOrId?.id;
  if (!id) return null;
  const current = store.getAudit(id);
  return store.updateAudit(id, {
    status: 'failed',
    details: sanitize({ ...(current?.details || {}), ...details }),
    message: String(error?.message || error || 'Unknown failure').slice(0, 500),
  });
}

async function run(category, action, details, task, summarize = null) {
  const audit = begin(category, action, details);
  try {
    const result = await task();
    const extra = summarize ? summarize(result) : {};
    succeed(audit, extra || {});
    return result;
  } catch (error) {
    fail(audit, error);
    throw error;
  }
}

module.exports = { sanitize, begin, succeed, fail, run };
