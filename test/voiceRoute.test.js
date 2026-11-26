'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { createVoiceRouter } = require('../server/routes/voice');
const { mintLiveKitToken, liveKitConfig, probeLiveKit, TOKEN_TTL_SECONDS } = require('../server/services/voiceToken');
const { TokenVerifier } = require('livekit-server-sdk');

const now = Date.parse('2026-11-26T00:00:00Z');
const self = '76561198000000031';
const other = '76561198000000032';
const root = path.join(__dirname, '..');

function character(steamId, x, y = 0, z = 0, name = 'Moss') {
  return { steamId, name, species: 'Tyrannosaurus', health: 91, location: { x, y, z } };
}

function cache(characters = [character(self, 812345.125, -743210.5, 99001.25), character(other, 814345.125, -743210.5, 99001.25, 'Fern')], overrides = {}) {
  const lastChecked = new Date(now).toISOString();
  return {
    online: true,
    stale: false,
    lastError: null,
    lastChecked,
    voiceSampledAt: lastChecked,
    characters,
    players: characters.map((entry) => ({ steamId: entry.steamId, name: entry.name })),
    ...overrides,
  };
}

function appFor(state, { enabled = true, user = { steam_id: self, username: 'Moss' }, mint, units = '100', probe } = {}) {
  let minted = null;
  const env = {
    VOICE_ENABLED: enabled ? '1' : '0',
    VOICE_UNITS_PER_METER: units,
    LIVEKIT_URL: 'wss://hollow-valley-voice-0thawldt.livekit.cloud',
    LIVEKIT_API_KEY: 'test-key',
    LIVEKIT_API_SECRET: 'super-secret-value',
    LIVEKIT_ROOM: 'hollow-valley',
  };
  const router = createVoiceRouter({
    getState: () => state,
    env,
    now: () => now,
    probe,
    mintToken: mint || (async (input) => {
      minted = input;
      return {
        url: env.LIVEKIT_URL,
        token: 'signed-token',
        room: env.LIVEKIT_ROOM,
        identity: input.identity,
        expiresAt: new Date(now + TOKEN_TTL_SECONDS * 1000).toISOString(),
      };
    }),
  });
  const app = express();
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/api/voice', router);
  return { app, env, minted: () => minted };
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function withServer(app, task) {
  const server = await listen(app);
  try {
    return await task(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function postToken(base, origin = base) {
  return fetch(`${base}/api/voice/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    body: '{}',
  });
}

function keysDeep(value, found = []) {
  if (!value || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    value.forEach((item) => keysDeep(item, found));
    return found;
  }
  for (const [key, child] of Object.entries(value)) {
    found.push(key);
    keysDeep(child, found);
  }
  return found;
}

test('voice token is refused when disabled, signed out, missing Steam, off server, or stale', async () => {
  const cases = [
    { name: 'disabled', enabled: false, state: cache(), user: { steam_id: self }, status: 404, code: 'VOICE_DISABLED' },
    { name: 'signed out', state: cache(), user: null, status: 401, code: 'NOT_LOGGED_IN' },
    { name: 'discord only', state: cache(), user: { steam_id: null, username: 'Discord' }, status: 403, code: 'STEAM_REQUIRED' },
    { name: 'short steam id', state: cache(), user: { steam_id: '12345' }, status: 403, code: 'STEAM_REQUIRED' },
    { name: 'not on server', state: cache([character(other, 1, 2, 3, 'Fern')]), status: 403, code: 'NOT_ON_SERVER' },
    { name: 'stale snapshot', state: cache(undefined, { voiceSampledAt: new Date(now - 60001).toISOString() }), status: 503, code: 'SNAPSHOT_STALE' },
    { name: 'rcon offline', state: cache(undefined, { rconOnline: false }), status: 503, code: 'SNAPSHOT_UNAVAILABLE' },
    { name: 'bad scale', state: cache(), units: '0', status: 503, code: 'VOICE_SCALE' },
  ];
  for (const item of cases) {
    let called = false;
    const { app } = appFor(item.state, {
      enabled: item.enabled !== false,
      user: Object.prototype.hasOwnProperty.call(item, 'user') ? item.user : { steam_id: self },
      units: item.units || '100',
      mint: async () => { called = true; throw new Error('mint should not run'); },
    });
    await withServer(app, async (base) => {
      const response = await postToken(base);
      const body = await response.json();
      assert.equal(response.status, item.status, item.name);
      assert.equal(body.code, item.code, item.name);
      assert.equal(called, false, item.name);
      const encoded = JSON.stringify(body);
      for (const secret of ['812345', '743210', '99001', 'super-secret-value', 'location', 'species']) {
        assert.equal(encoded.includes(secret), false, `${item.name} ${secret}`);
      }
    });
  }
});

test('disabled voice stays 404 before the origin check', async () => {
  const { app } = appFor(cache(), { enabled: false, mint: async () => { throw new Error('mint should not run'); } });
  await withServer(app, async (base) => {
    const response = await postToken(base, '');
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, 'VOICE_DISABLED');
  });
});

test('a cross-site token request does not mint', async () => {
  let called = false;
  const { app } = appFor(cache(), { mint: async () => { called = true; return {}; } });
  await withServer(app, async (base) => {
    const response = await postToken(base, 'https://evil.example');
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'BAD_ORIGIN');
    assert.equal(called, false);
  });
});

test('gains payload has no coordinates and an eligible token uses only the Steam identity', async () => {
  const { app, minted } = appFor(cache());
  await withServer(app, async (base) => {
    const gainsResponse = await fetch(`${base}/api/voice/gains`);
    const gains = await gainsResponse.json();
    assert.equal(gainsResponse.status, 200);
    assert.match(gainsResponse.headers.get('cache-control'), /no-store/);
    assert.deepEqual(keysDeep(gains), ['positionsSlow', 'gains', 'identity', 'gain', 'audible', 'displayName']);
    assert.equal(gains.positionsSlow, false);
    assert.equal(gains.gains.length, 1);
    assert.equal(gains.gains[0].identity, other);
    assert.equal(gains.gains[0].displayName, 'Fern');
    assert.equal(gains.gains[0].audible, true);
    assert.equal(gains.gains[0].gain, 1);
    const encoded = JSON.stringify(gains);
    for (const secret of ['812345', '743210', '99001', 'location', 'species', 'Tyrannosaurus', 'health']) {
      assert.equal(encoded.includes(secret), false, secret);
    }

    const tokenResponse = await postToken(base);
    const token = await tokenResponse.json();
    assert.equal(tokenResponse.status, 200);
    assert.deepEqual(Object.keys(token).sort(), ['expiresAt', 'identity', 'positionsSlow', 'room', 'token', 'url']);
    assert.equal(token.positionsSlow, false);
    assert.equal(token.identity, self);
    assert.equal(token.room, 'hollow-valley');
    assert.equal(JSON.stringify(token).includes('super-secret-value'), false);
    assert.equal(minted().identity, self);
    assert.equal(minted().name, 'Moss');
    assert.equal(Object.hasOwn(minted(), 'location'), false);
  });
});

test('livekit token grants the steam identity a microphone in one room', async () => {
  const env = {
    LIVEKIT_URL: 'wss://hollow-valley-voice-0thawldt.livekit.cloud',
    LIVEKIT_API_KEY: 'API_TEST_KEY',
    LIVEKIT_API_SECRET: 'this-is-a-test-secret-with-enough-length',
    LIVEKIT_ROOM: 'hollow-valley',
  };
  assert.equal(liveKitConfig({ ...env, LIVEKIT_URL: 'http://voice.example/room' }), null);
  const issued = await mintLiveKitToken({ identity: self, name: 'Moss\n<script>', env, nowMs: now });
  assert.equal(issued.identity, self);
  assert.equal(issued.room, 'hollow-valley');
  assert.equal(issued.url, env.LIVEKIT_URL);
  assert.equal(issued.token.includes(env.LIVEKIT_API_SECRET), false);
  assert.equal(Date.parse(issued.expiresAt) - now, TOKEN_TTL_SECONDS * 1000);
  const claims = await new TokenVerifier(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET).verify(issued.token);
  assert.equal(claims.sub, self);
  assert.equal(claims.name, 'Moss<script>');
  assert.equal(claims.video.room, 'hollow-valley');
  assert.equal(claims.video.roomJoin, true);
  assert.equal(claims.video.canPublish, true);
  assert.equal(claims.video.canPublishData, false);
  assert.deepEqual(claims.video.canPublishSources, ['microphone']);
  assert.equal(claims.exp - claims.nbf, TOKEN_TTL_SECONDS);
  for (const key of Object.keys(claims)) assert.equal(['location', 'x', 'y', 'z'].includes(key), false);
});

test('admin diagnosis names the gate and does not return coordinates or secrets', async () => {
  const probe = async () => ({ status: 'unauthorized', urlOk: true, roomOk: true, keyPresent: true, secretPresent: true });
  const denied = appFor(cache(), { user: { steam_id: self, is_admin: 0 }, probe });
  await withServer(denied.app, async (base) => {
    const response = await fetch(`${base}/api/voice/diagnosis`);
    assert.equal(response.status, 403);
  });
  const allowed = appFor(cache(), { user: { steam_id: self, is_admin: 1 }, probe });
  await withServer(allowed.app, async (base) => {
    const response = await fetch(`${base}/api/voice/diagnosis`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.reason, 'ok');
    assert.equal(body.maxSnapshotAgeMs, 60000);
    assert.equal(body.positionsSlow, false);
    assert.equal(body.selfPositioned, true);
    assert.equal(body.positionedCount, 2);
    assert.equal(body.livekit.status, 'unauthorized');
    assert.equal(body.steamFormatOk, true);
    const encoded = JSON.stringify(body);
    for (const secret of ['812345', '743210', '99001', 'super-secret-value', self, other, 'location', 'Tyrannosaurus']) {
      assert.equal(encoded.includes(secret), false, secret);
    }
  });
});

test('livekit probe classifies unauthorized without echoing the secret', async () => {
  const env = {
    LIVEKIT_URL: 'wss://voice.example.test',
    LIVEKIT_API_KEY: 'key',
    LIVEKIT_API_SECRET: 'super-secret-value',
    LIVEKIT_ROOM: 'hollow-valley',
  };
  const denied = await probeLiveKit(env, {
    listRooms: async () => {
      const error = new Error('unauthorized');
      error.status = 401;
      throw error;
    },
  });
  assert.equal(denied.status, 'unauthorized');
  assert.equal(JSON.stringify(denied).includes('super-secret-value'), false);
  const offline = await probeLiveKit({ ...env, LIVEKIT_ROOM: 'not a room' });
  assert.equal(offline.status, 'not_configured');
});

test('a snapshot between 30s and 60s still issues a token and gains', async () => {
  const slowState = cache(undefined, { voiceSampledAt: new Date(now - 30938).toISOString() });
  let called = false;
  const { app } = appFor(slowState, {
    mint: async (input) => {
      called = true;
      return {
        url: 'wss://hollow-valley-voice-0thawldt.livekit.cloud',
        token: 'signed-token',
        room: 'hollow-valley',
        identity: input.identity,
        expiresAt: new Date(now + 1800000).toISOString(),
      };
    },
  });
  await withServer(app, async (base) => {
    const tokenResponse = await postToken(base);
    const token = await tokenResponse.json();
    assert.equal(tokenResponse.status, 200);
    assert.equal(token.positionsSlow, true);
    assert.equal(called, true);
    const gainsResponse = await fetch(`${base}/api/voice/gains`);
    const gains = await gainsResponse.json();
    assert.equal(gainsResponse.status, 200);
    assert.equal(gains.positionsSlow, true);
    assert.equal(gains.gains.length, 1);
    assert.equal(gains.gains[0].gain, 1);
    assert.equal(gains.gains[0].audible, true);
    const encoded = JSON.stringify({ token, gains });
    for (const secret of ['812345', '743210', '99001', 'location']) {
      assert.equal(encoded.includes(secret), false, secret);
    }
  });
});

test('voice page, navigation, and server entry stay off the map position feed', () => {
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  const page = read('public/voice.html');
  const client = read('public/assets/voice.js');
  const route = read('server/routes/voice.js');
  const service = read('server/services/voiceProximity.js');
  const index = read('server/index.js');
  const nav = read('public/partials/nav.html');
  const common = read('public/assets/common.js');
  assert.match(page, /Keep this tab open/);
  assert.match(page, /phone or iPad may cut the microphone/);
  assert.match(page, /Headphones are recommended/);
  assert.match(page, /livekit-client@2\.25\.0/);
  assert.match(page, /integrity="sha384-/);
  assert.match(client, /\/api\/voice\/gains/);
  assert.match(client, /\/api\/voice\/diagnosis/);
  assert.match(client, /The voice room did not connect/);
  assert.match(page, /Positions are updating slowly/);
  assert.match(read('public/voice.html'), /id="voice-slow-notice"/);
  assert.match(read('.env.example'), /VOICE_MAX_SNAPSHOT_AGE_MS=60000/);
  assert.match(read('render.yaml'), /key: VOICE_MAX_SNAPSHOT_AGE_MS\n\s+value: "60000"/);
  assert.match(client, /GATE_RMS/);
  assert.doesNotMatch(client, /\/api\/map\/positions/);
  assert.doesNotMatch(route, /\/api\/map\/positions|RCON_HOST|RCON_PASSWORD/);
  assert.doesNotMatch(service, /RCON_HOST|RCON_PASSWORD|basic-ftp|ssh2/);
  assert.match(index, /app\.use\("\/api\/voice", voiceRouter\)/);
  assert.match(index, /voiceEnabled: process\.env\.VOICE_ENABLED === "1"/);
  assert.match(index, /"voice"/);
  assert.match(nav, /href="\/livemap">LIVE MAP<\/a>\s*<a href="\/voice" id="voice-nav-link" hidden>Voice<\/a>/);
  assert.match(common, /voice-nav-link/);
  assert.match(common, /voiceLink\.hidden = !me\.voiceEnabled/);
  assert.match(read('render.yaml'), /key: VOICE_ENABLED\n\s+sync: false/);
  assert.match(read('.env.example'), /LIVEKIT_API_SECRET=\n/);
  assert.doesNotMatch(read('.env.example'), /LIVEKIT_API_SECRET=.+/);
});
