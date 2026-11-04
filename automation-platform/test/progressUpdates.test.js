'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const os = require('node:os');
const express = require('express');

process.env.AUTOMATION_DB_PATH = path.join(os.tmpdir(), 'hv-progress-test-' + randomUUID() + '.sqlite');
const outbox = require('../src/services/herbyBotOutboxService');
const { createProgressUpdateRouter, validateProgressUpdate, formatProgressUpdate } =
  require('../src/routes/progressUpdateRoutes');
const { deliverEvent, destinationChannelId } = require('../integration/herbyBotBridge');

const REFERENCE = 'https://github.com/Goofylagaming/hollow-valley-site/pull/233';
const valid = {
  stage: 'testing',
  scope: 'website',
  milestone: 'HV-W01.1',
  summary: 'Status page and readiness tests are under review.',
  reference: REFERENCE,
  nonce: 'hv-progress:manual:123456789',
};

async function makeServer(queueProgress) {
  const app = express();
  app.use(express.json());
  app.use('/api/progress-updates', createProgressUpdateRouter({ queueProgress }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  return {
    url: 'http://127.0.0.1:' + server.address().port + '/api/progress-updates',
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

async function request(url, token, body = valid) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token ? 'Bearer ' + token : '',
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, cache: response.headers.get('cache-control'), json: await response.json() };
}

test('endpoint is disabled when no dedicated token is configured', async () => {
  const original = process.env.HV_DISCORD_PROGRESS_TOKEN;
  delete process.env.HV_DISCORD_PROGRESS_TOKEN;
  let queued = 0;
  const site = await makeServer(() => { queued++; });
  try {
    const result = await request(site.url, 'not-a-token');
    assert.equal(result.status, 503);
    assert.equal(queued, 0);
    assert.equal(result.cache, 'no-store');
  } finally {
    await site.close();
    if (original === undefined) delete process.env.HV_DISCORD_PROGRESS_TOKEN;
    else process.env.HV_DISCORD_PROGRESS_TOKEN = original;
  }
});

test('wrong or missing token cannot enqueue a Discord update', async () => {
  const original = process.env.HV_DISCORD_PROGRESS_TOKEN;
  process.env.HV_DISCORD_PROGRESS_TOKEN = 'server-progress-test-token-123456789';
  let queued = 0;
  const site = await makeServer(() => { queued++; });
  try {
    for (const credential of ['', 'wrong-token']) {
      const result = await request(site.url, credential);
      assert.equal(result.status, 401);
      assert.equal(queued, 0);
      assert.doesNotMatch(JSON.stringify(result.json), /server-progress-test-token/);
    }
  } finally {
    await site.close();
    if (original === undefined) delete process.env.HV_DISCORD_PROGRESS_TOKEN;
    else process.env.HV_DISCORD_PROGRESS_TOKEN = original;
  }
});

test('authenticated updates use a dedicated progress destination and dedupe by nonce', async () => {
  const original = process.env.HV_DISCORD_PROGRESS_TOKEN;
  process.env.HV_DISCORD_PROGRESS_TOKEN = 'server-progress-test-token-123456789';
  const site = await makeServer(outbox.queueProgress);
  try {
    const first = await request(site.url, process.env.HV_DISCORD_PROGRESS_TOKEN);
    const second = await request(site.url, process.env.HV_DISCORD_PROGRESS_TOKEN);
    assert.equal(first.status, 202);
    assert.equal(second.status, 202);
    assert.equal(first.json.eventId, second.json.eventId);
    assert.equal(first.json.deliveryStatus, 'pending');
    const conflict = await request(site.url, process.env.HV_DISCORD_PROGRESS_TOKEN,
      { ...valid, summary: 'Different payload with reused nonce' });
    assert.equal(conflict.status, 409);
    const event = outbox.claimMessages({ limit: 50, leaseSeconds: 60 })
      .find(item => item.id === first.json.eventId);
    assert.equal(event.destination, 'progress');
    assert.match(event.message, /HV-W01.1/);
    assert.doesNotMatch(event.message, /server-progress-test-token/);
  } finally {
    await site.close();
    if (original === undefined) delete process.env.HV_DISCORD_PROGRESS_TOKEN;
    else process.env.HV_DISCORD_PROGRESS_TOKEN = original;
  }
});

test('malformed payloads cannot spoof other repositories or post unapproved statuses', () => {
  assert.throws(() => validateProgressUpdate({ ...valid, stage: 'anything' }), /Invalid progress stage/);
  assert.throws(() => validateProgressUpdate({ ...valid, reference: 'https://example.org' }), /Reference/);
  assert.throws(() => validateProgressUpdate({ ...valid, reference: 'https://github.com/other/repo/pull/1' }), /Reference/);
  assert.throws(() => validateProgressUpdate({ ...valid, milestone: '<@everyone>' }), /Invalid milestone/);
  assert.throws(() => validateProgressUpdate({ ...valid, nonce: 'duplicate' }), /idempotency/);
  assert.throws(() => validateProgressUpdate({ ...valid, summary: 'x'.repeat(351) }), /Summary/);
  const normalized = validateProgressUpdate({ ...valid, summary: '  Fixed @everyone <@1234> *urgent*  ' });
  const result = formatProgressUpdate(normalized);
  assert.doesNotMatch(result, /@everyone/);
  assert.match(result, /@​everyone/);
  assert.match(result, /Server Progress & Updates/);
});

test('progress updates use the existing HerbyBot client and only the chosen channel', async () => {
  const prevProgress = process.env.DISCORD_PROGRESS_CHANNEL_ID;
  const prevAnnouncement = process.env.DISCORD_ANNOUNCEMENT_CHANNEL_ID;
  process.env.DISCORD_PROGRESS_CHANNEL_ID = '1550133934871023679';
  process.env.DISCORD_ANNOUNCEMENT_CHANNEL_ID = '111111111111111111';
  const sends = [];
  const client = {
    isReady: () => true,
    channels: { fetch: async id => ({
      isTextBased: () => true,
      send: async msg => { sends.push({ id, msg }); return { id: 'discord-test-message' }; },
    }) },
  };
  try {
    assert.equal(destinationChannelId('progress'), '1550133934871023679');
    assert.equal(destinationChannelId('announcement'), '111111111111111111');
    const result = await deliverEvent(client, {
      id: 'hv-progress-message-1',
      nonce: 'hv-progress:release:' + 'a'.repeat(40),
      destination: 'progress',
      message: 'Hollow Valley update',
    });
    assert.equal(result.channelId, '1550133934871023679');
    assert.equal(sends.length, 1);
    assert.equal(sends[0].msg.content, 'Hollow Valley update');
    assert.deepEqual(sends[0].msg.allowedMentions, { parse: [] });
    assert.equal(sends[0].msg.enforceNonce, true);
  } finally {
    if (prevProgress === undefined) delete process.env.DISCORD_PROGRESS_CHANNEL_ID;
    else process.env.DISCORD_PROGRESS_CHANNEL_ID = prevProgress;
    if (prevAnnouncement === undefined) delete process.env.DISCORD_ANNOUNCEMENT_CHANNEL_ID;
    else process.env.DISCORD_ANNOUNCEMENT_CHANNEL_ID = prevAnnouncement;
  }
});
