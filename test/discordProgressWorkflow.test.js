'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildProgressPayload, postProgressUpdate } = require('../scripts/post-hv-discord-progress.cjs');

const root = path.join(__dirname, '..');
const read = (pathName) => fs.readFileSync(path.join(root, pathName), 'utf8');
const sha = '0123456789abcdef'.repeat(2) + '01234567';

function baseEnv(eventName) {
  return {
    GITHUB_REPOSITORY: 'Goofylagaming/hollow-valley-site',
    GITHUB_REF: 'refs/heads/master',
    GITHUB_EVENT_NAME: eventName,
    GITHUB_SHA: sha,
    GITHUB_RUN_ID: '1234567890',
  };
}

test('verified master push creates one live notification per revision', () => {
  const payload = buildProgressPayload({ ...baseEnv('push'), AUTOMATION_CHANGED: 'true' }, {
    headline: () => 'HV-W01.1 improve public status and snapshots',
  });
  assert.equal(payload.stage, 'live');
  assert.equal(payload.scope, 'both');
  assert.equal(payload.milestone, 'HV-W01.1');
  assert.equal(payload.reference, 'https://github.com/Goofylagaming/hollow-valley-site/commit/' + sha);
  assert.equal(payload.nonce, 'hv-progress:release:' + sha);
});

test('manual updates can report test progress without asserting release happened', () => {
  const payload = buildProgressPayload({
    ...baseEnv('workflow_dispatch'),
    HV_PROGRESS_STAGE: 'testing',
    HV_PROGRESS_MILESTONE: 'HV-W01.2',
    HV_PROGRESS_SUMMARY: 'Audit timeline unit tests passed; browser QA outstanding.',
  });
  assert.equal(payload.stage, 'testing');
  assert.equal(payload.scope, 'general');
  assert.equal(payload.nonce, 'hv-progress:manual:1234567890');
  assert.match(payload.reference, /actions\/runs\/1234567890/);
});

test('events from other repos, other branches and unsupported sources cannot announce progress', () => {
  assert.throws(() => buildProgressPayload({
    ...baseEnv('push'), GITHUB_REPOSITORY: 'another/repo',
  }, { headline: () => 'bad' }), /Hollow Valley repository/);
  assert.throws(() => buildProgressPayload({
    ...baseEnv('push'), GITHUB_REF: 'refs/heads/some-feature',
  }, { headline: () => 'bad' }), /master branch/);
  assert.throws(() => buildProgressPayload(baseEnv('pull_request')), /Unsupported progress event/);
});

test('disabled integration does not send a network request', async () => {
  let requests = 0;
  const result = await postProgressUpdate({}, {
    token: '', fetchImpl: async () => { requests++; throw new Error('no'); },
  });
  assert.equal(result.skipped, true);
  assert.equal(requests, 0);
});

test('publisher sends fixed HTTPS endpoint with a dedicated token, and retries 503 with same payload', async () => {
  const body = buildProgressPayload(baseEnv('push'), { headline: () => 'HV-W01.1 website update' });
  let count = 0;
  const calls = [];
  const result = await postProgressUpdate(body, {
    token: 'local-only-test-token',
    wait: async () => {},
    fetchImpl: async (url, options) => {
      count++;
      calls.push({ url, options });
      return count === 1
        ? new Response(JSON.stringify({ error: 'temporarily unavailable' }), { status: 503 })
        : Response.json({ ok: true, eventId: 'abc123', deliveryStatus: 'pending' }, { status: 202 });
    },
  });
  assert.equal(result.eventId, 'abc123');
  assert.equal(count, 2);
  assert.ok(calls.every(c => c.url === 'https://hollow-valley-automation.onrender.com/api/progress-updates'));
  assert.ok(calls.every(c => c.options.headers.Authorization === 'Bearer local-only-test-token'));
  assert.ok(calls.every(c => JSON.parse(c.options.body).nonce === body.nonce));
});

test('publisher stops on unauthorized request and never falls back to another recipient', async () => {
  let attempts = 0;
  await assert.rejects(
    postProgressUpdate({}, {
      token: 'local-only-test-token',
      wait: async () => {},
      fetchImpl: async () => {
        attempts++;
        return Response.json({ error: 'unauthorized' }, { status: 401 });
      },
    }),
    /HTTP 401/
  );
  assert.equal(attempts, 1);
});

test('the automatic Discord workflow waits for deployment readiness before publishing', () => {
  const workflow = read('.github/workflows/hv-discord-progress.yml');
  assert.match(workflow, /branches: \[master\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /scripts\/verify-readiness\.cjs https:\/\/hollow-valley-site\.onrender\.com/);
  assert.match(workflow, /scripts\/verify-readiness\.cjs https:\/\/hollow-valley-automation\.onrender\.com/);
  assert.match(workflow, /AUTOMATION_CHANGED == 'true'/);
  const websiteGate = workflow.indexOf('Verify website readiness');
  const automationGate = workflow.indexOf('Verify automation recovery');
  const notification = workflow.indexOf('Queue Hollow Valley progress update');
  assert.ok(websiteGate >= 0 && websiteGate < automationGate && automationGate < notification);
  assert.match(workflow, /secrets\.HV_DISCORD_PROGRESS_TOKEN/);
  assert.doesNotMatch(workflow, /DISCORD_BOT_TOKEN|AUTOMATION_ADMIN_TOKEN|HOLLOW_VALLEY_API_TOKEN/);
});
