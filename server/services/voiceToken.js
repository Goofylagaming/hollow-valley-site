'use strict';

const { AccessToken, RoomServiceClient, TrackSource } = require('livekit-server-sdk');
const { sanitizeName } = require('./voiceProximity');

const TOKEN_TTL_SECONDS = 30 * 60;

function liveKitConfig(env = process.env) {
  const url = String(env.LIVEKIT_URL || '').trim();
  const apiKey = String(env.LIVEKIT_API_KEY || '').trim();
  const apiSecret = String(env.LIVEKIT_API_SECRET || '').trim();
  const room = String(env.LIVEKIT_ROOM || '').trim();
  if (!apiKey || !apiSecret || !/^[A-Za-z0-9_-]{1,64}$/.test(room)) return null;
  if (!/^wss:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[\w.~:/?#[\]@!$&'()*+,;=%-]*)?$/.test(url)) return null;
  if (url.includes(apiSecret)) return null;
  return { url, apiKey, apiSecret, room };
}

// Room-wide subscribe is intentional for this first version. Limiting who may
// subscribe by distance is a follow-up; the browser only turns playback down.
async function mintLiveKitToken({ identity, name, env = process.env, nowMs = Date.now() } = {}) {
  const steamId = String(identity || '');
  if (!/^\d{17}$/.test(steamId)) {
    const error = new Error('Voice is offline.');
    error.code = 'VOICE_UNCONFIGURED';
    throw error;
  }
  const config = liveKitConfig(env);
  if (!config) {
    const error = new Error('Voice is offline.');
    error.code = 'VOICE_UNCONFIGURED';
    throw error;
  }
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: steamId,
    name: sanitizeName(name),
    ttl: TOKEN_TTL_SECONDS,
  });
  token.addGrant({
    roomJoin: true,
    room: config.room,
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
    canUpdateOwnMetadata: false,
    canPublishSources: [TrackSource.MICROPHONE],
  });
  const jwt = await token.toJwt();
  if (typeof jwt !== 'string' || jwt.includes(config.apiSecret)) {
    const error = new Error('Voice is offline.');
    error.code = 'VOICE_UNCONFIGURED';
    throw error;
  }
  return {
    url: config.url,
    token: jwt,
    room: config.room,
    identity: steamId,
    expiresAt: new Date(nowMs + TOKEN_TTL_SECONDS * 1000).toISOString(),
  };
}

function liveKitFlags(env = process.env) {
  return {
    urlOk: /^wss:\/\/.+/i.test(String(env.LIVEKIT_URL || '').trim()),
    roomOk: /^[A-Za-z0-9_-]{1,64}$/.test(String(env.LIVEKIT_ROOM || '').trim()),
    keyPresent: Boolean(String(env.LIVEKIT_API_KEY || '').trim()),
    secretPresent: Boolean(String(env.LIVEKIT_API_SECRET || '').trim()),
  };
}

// Confirms the key can call LiveKit. The result is a status word only.
async function probeLiveKit(env = process.env, { listRooms, timeoutMs = 5000 } = {}) {
  const flags = liveKitFlags(env);
  const config = liveKitConfig(env);
  if (!config) return { status: 'not_configured', ...flags };
  const list = listRooms || (async () => {
    const host = config.url.replace(/^wss:/i, 'https:');
    const client = new RoomServiceClient(host, config.apiKey, config.apiSecret);
    await client.listRooms([config.room]);
  });
  let timer;
  try {
    await Promise.race([
      Promise.resolve().then(() => list()),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })), timeoutMs);
      }),
    ]);
    return { status: 'ok', ...flags };
  } catch (error) {
    const message = String(error?.message || '');
    const unauthorized = error?.status === 401 || /unauthor|unauth|permission denied|invalid api key/i.test(message);
    return { status: error?.code === 'TIMEOUT' ? 'unreachable' : unauthorized ? 'unauthorized' : 'unreachable', ...flags };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  mintLiveKitToken,
  liveKitConfig,
  liveKitFlags,
  probeLiveKit,
  TOKEN_TTL_SECONDS,
};
