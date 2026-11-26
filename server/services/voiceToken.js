'use strict';

const { AccessToken, TrackSource } = require('livekit-server-sdk');
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

module.exports = {
  mintLiveKitToken,
  liveKitConfig,
  TOKEN_TTL_SECONDS,
};
