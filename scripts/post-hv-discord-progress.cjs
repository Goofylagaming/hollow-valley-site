'use strict';

// GitHub Actions -> automation -> existing HerbyBot outbox. No Discord token,
// game-server token or payment credential is available to this script.
const { execFileSync } = require('node:child_process');

const REPO = 'Goofylagaming/hollow-valley-site';
const ENDPOINT = 'https://hollow-valley-automation.onrender.com/api/progress-updates';
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const RUN_PATTERN = /^[1-9]\d{5,19}$/;

function gitHeadline() {
  return execFileSync('git', ['log', '-1', '--pretty=%s'], {
    encoding: 'utf8', timeout: 5000,
  }).trim();
}

function buildProgressPayload(env, { headline = gitHeadline } = {}) {
  if (env.GITHUB_REPOSITORY !== REPO) throw new Error('Progress updates may only originate from the Hollow Valley repository.');
  if (env.GITHUB_REF !== 'refs/heads/master') throw new Error('Progress updates require the master branch.');
  const source = env.GITHUB_EVENT_NAME;
  if (!['push', 'workflow_dispatch'].includes(source)) throw new Error('Unsupported progress event.');

  if (source === 'push') {
    const sha = String(env.GITHUB_SHA || '');
    if (!SHA_PATTERN.test(sha)) throw new Error('Release SHA is invalid.');
    const title = headline().trim().split(/\r?\n/)[0].slice(0, 350);
    const milestone = title.match(/\bHV-W\d{2}(?:\.\d+)?\b/i)?.[0]?.toUpperCase() || 'Hollow Valley';
    return {
      stage: 'live',
      scope: env.AUTOMATION_CHANGED === 'true' ? 'both' : 'website',
      milestone,
      summary: title || 'Verified Hollow Valley website release.',
      reference: 'https://github.com/' + REPO + '/commit/' + sha,
      nonce: 'hv-progress:release:' + sha,
    };
  }

  const runId = String(env.GITHUB_RUN_ID || '');
  if (!RUN_PATTERN.test(runId)) throw new Error('Manual progress run ID is invalid.');
  const summary = String(env.HV_PROGRESS_SUMMARY || '').trim();
  if (!summary) throw new Error('A progress summary is required.');
  return {
    stage: String(env.HV_PROGRESS_STAGE || 'building').trim(),
    scope: 'general',
    milestone: String(env.HV_PROGRESS_MILESTONE || 'Hollow Valley').trim(),
    summary,
    reference: String(env.HV_PROGRESS_REFERENCE || '').trim() ||
      'https://github.com/' + REPO + '/actions/runs/' + runId,
    nonce: 'hv-progress:manual:' + runId,
  };
}

async function postProgressUpdate(payload, {
  token = process.env.HV_DISCORD_PROGRESS_TOKEN,
  fetchImpl = fetch,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  if (!String(token || '').trim()) {
    return { skipped: true, reason: 'HV_DISCORD_PROGRESS_TOKEN GitHub secret is not configured' };
  }
  const target = new URL(ENDPOINT);
  if (target.protocol !== 'https:') throw new Error('Progress endpoint must use HTTPS.');
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetchImpl(target.href, {
        method: 'POST',
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12000),
      });
      if (response.status === 202) {
        const result = await response.json();
        if (!result?.ok) throw new Error('Progress API returned an unexpected acknowledgement.');
        return { skipped: false, deliveryStatus: result.deliveryStatus, eventId: result.eventId };
      }
      if (![502, 503, 504].includes(response.status) || attempt === 3) {
        throw new Error('Progress API rejected the update (HTTP ' + response.status + ').');
      }
    } catch (error) {
      if (attempt === 3 || /rejected|unexpected acknowledgement/.test(error.message)) throw error;
    }
    await wait(1000 * attempt);
  }
  throw new Error('Progress update was not acknowledged.');
}

if (require.main === module) {
  (async () => {
    const token = String(process.env.HV_DISCORD_PROGRESS_TOKEN || '').trim();
    if (!token) {
      console.log('Progress notification skipped: GitHub secret not configured.');
      return;
    }
    const payload = buildProgressPayload(process.env);
    const result = await postProgressUpdate(payload, { token });
    console.log('Progress event accepted by automation outbox (' + result.deliveryStatus +
      '). Delivery to Discord remains subject to HerbyBot acknowledgement.');
  })().catch(error => {
    console.error('Hollow Valley progress notification failed: ' + error.message);
    process.exitCode = 1;
  });
}

module.exports = { REPO, ENDPOINT, buildProgressPayload, postProgressUpdate };
