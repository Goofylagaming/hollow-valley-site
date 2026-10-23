'use strict';

async function verifyReadiness(url, revision, { attempts = 90, delayMs = 10000, fetchImpl = fetch,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let successes = 0;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetchImpl(new URL('/readyz', url), { redirect: 'error', signal: AbortSignal.timeout(4000) });
      const body = await response.json();
      successes = response.status === 200 && body.ok === true && body.revision === revision ? successes + 1 : 0;
      if (successes >= 3) return;
    } catch { successes = 0; }
    if (attempt + 1 < attempts) await sleep(delayMs);
  }
  throw new Error('Expected revision did not pass three consecutive readiness checks; stop deployment.');
}
if (require.main === module) {
  const [url, revision] = process.argv.slice(2);
  if (!url || !/^[a-f0-9]{40}$/.test(revision || '')) throw new Error('Usage: verify-readiness.cjs URL COMMIT_SHA');
  verifyReadiness(url, revision).then(() => console.log('Revision ready across three checks'))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { verifyReadiness };
