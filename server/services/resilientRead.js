'use strict';

// Opt-in for verified read-only operations. Never wrap command submission.
function createResilientRead({ threshold = 3, cooldownMs = 15000, now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let failures = 0, openedAt = null, probing = false;
  return async function read(operation, signal) {
    const halfOpen = openedAt !== null;
    if (halfOpen && (now() - openedAt < cooldownMs || probing)) {
      const error = new Error('Upstream temporarily unavailable');
      error.status = 503;
      throw error;
    }
    if (halfOpen) probing = true;
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          const value = await operation();
          failures = 0; openedAt = null;
          return value;
        } catch (error) {
          const transient = !error.status || [502, 503, 504].includes(error.status);
          if (!transient) throw error;
          if (attempt === 0 && !halfOpen && !signal?.aborted) {
            await sleep(100 + Math.floor(Math.random() * 200));
            if (!signal?.aborted) continue;
          }
          if (++failures >= threshold) openedAt = now();
          throw error;
        }
      }
    } finally { if (halfOpen) probing = false; }
  };
}
module.exports = { createResilientRead };
