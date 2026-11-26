'use strict';

const express = require('express');
const { requireAdmin } = require('../middleware/requireAuth');
const { assessVoice, explainVoice, maxSnapshotAgeMs, unitsPerMeter, voiceEnabled } = require('../services/voiceProximity');
const { mintLiveKitToken, probeLiveKit } = require('../services/voiceToken');

const STEAM_ID = /^\d{17}$/;

function expectedOrigin(req, env) {
  if (env.PUBLIC_SITE_URL) return new URL(env.PUBLIC_SITE_URL).origin;
  return `${req.protocol}://${req.get('host')}`;
}

function fail(res, status, code, error) {
  return res.status(status).json({ error, code });
}

const GATE_HTTP = {
  not_on_server: [403, 'NOT_ON_SERVER', 'You are not on the Hollow Valley server right now.'],
  stale_timestamp: [503, 'SNAPSHOT_STALE', 'Voice is offline.'],
  unavailable: [503, 'SNAPSHOT_UNAVAILABLE', 'Voice is offline.'],
  invalid_scale: [503, 'VOICE_SCALE', 'Voice is offline.'],
};

function createVoiceRouter({ getState, mintToken, env, now, probe } = {}) {
  const router = express.Router();
  const readState = getState || (() => require('../services/serverStatus').getState());
  const mint = mintToken || mintLiveKitToken;
  const probeLive = probe || probeLiveKit;
  const environment = () => env || process.env;
  const nowMs = () => (now ? now() : Date.now());

  function guard(req, res) {
    const currentEnv = environment();
    if (!voiceEnabled(currentEnv)) {
      fail(res, 404, 'VOICE_DISABLED', 'Voice is not enabled.');
      return null;
    }
    if (!req.user) {
      fail(res, 401, 'NOT_LOGGED_IN', 'Not logged in');
      return null;
    }
    const steamId = String(req.user.steam_id || '');
    if (!STEAM_ID.test(steamId)) {
      fail(res, 403, 'STEAM_REQUIRED', 'Voice requires a Steam sign-in. Discord-only accounts cannot join.');
      return null;
    }
    const scale = unitsPerMeter(currentEnv);
    if (scale == null) {
      fail(res, 503, 'VOICE_SCALE', 'Voice is offline.');
      return null;
    }
    const assessment = assessVoice(readState(), steamId, {
      nowMs: nowMs(),
      unitsPerMeter: scale,
      maxAgeMs: maxSnapshotAgeMs(currentEnv),
    });
    if (!assessment.ok) {
      const [status, code, error] = GATE_HTTP[assessment.reason] || [503, 'VOICE_OFFLINE', 'Voice is offline.'];
      fail(res, status, code, error);
      return null;
    }
    return { steamId, assessment, currentEnv };
  }

  router.post('/token', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!voiceEnabled(environment())) {
      return fail(res, 404, 'VOICE_DISABLED', 'Voice is not enabled.');
    }
    let origin;
    try {
      origin = expectedOrigin(req, environment());
    } catch {
      return fail(res, 503, 'VOICE_OFFLINE', 'Voice is offline.');
    }
    if (!req.get('Origin') || req.get('Origin') !== origin) {
      return fail(res, 403, 'BAD_ORIGIN', 'Open voice from the Hollow Valley website.');
    }
    const allowed = guard(req, res);
    if (!allowed) return undefined;
    try {
      const issued = await mint({
        identity: allowed.steamId,
        name: allowed.assessment.displayName,
        env: allowed.currentEnv,
        nowMs: nowMs(),
      });
      const secret = String(allowed.currentEnv.LIVEKIT_API_SECRET || '');
      if (!issued || issued.identity !== allowed.steamId || typeof issued.token !== 'string' || (secret && issued.token.includes(secret))) {
        return fail(res, 503, 'VOICE_OFFLINE', 'Voice is offline.');
      }
      return res.json({
        url: issued.url,
        token: issued.token,
        room: issued.room,
        identity: issued.identity,
        expiresAt: issued.expiresAt,
        positionsSlow: allowed.assessment.positionsSlow === true,
      });
    } catch {
      console.warn('[voice] token mint failed');
      return fail(res, 503, 'LIVEKIT_MINT_FAILED', 'Voice is offline.');
    }
  });

  router.get('/diagnosis', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const currentEnv = environment();
    if (!voiceEnabled(currentEnv)) {
      return res.json({ enabled: false, reason: 'disabled', livekit: { status: 'not_configured' } });
    }
    const steamId = String(req.user?.steam_id || '');
    const scale = unitsPerMeter(currentEnv);
    const limit = maxSnapshotAgeMs(currentEnv);
    const explanation = scale == null
      ? { ok: false, reason: 'invalid_scale', ageMs: null, maxSnapshotAgeMs: limit, slowAfterMs: 30000, positionsSlow: false, online: false, stale: false, hasError: false, serverFlag: 'absent', rconFlag: 'absent', characterCount: 0, steamIdCount: 0, positionedCount: 0, selfPositioned: false }
      : explainVoice(readState(), steamId, { nowMs: nowMs(), unitsPerMeter: scale, maxAgeMs: limit });
    let livekit = { status: 'not_configured' };
    try {
      livekit = await probeLive(currentEnv);
    } catch {
      livekit = { status: 'unreachable' };
    }
    const { status, urlOk, roomOk, keyPresent, secretPresent } = livekit;
    return res.json({
      enabled: true,
      steamFormatOk: STEAM_ID.test(steamId),
      reason: explanation.reason,
      ageMs: explanation.ageMs,
      maxSnapshotAgeMs: explanation.maxSnapshotAgeMs,
      slowAfterMs: explanation.slowAfterMs,
      positionsSlow: explanation.positionsSlow === true,
      online: explanation.online,
      stale: explanation.stale,
      hasError: explanation.hasError,
      serverFlag: explanation.serverFlag,
      rconFlag: explanation.rconFlag,
      characterCount: explanation.characterCount,
      steamIdCount: explanation.steamIdCount,
      positionedCount: explanation.positionedCount,
      selfPositioned: explanation.selfPositioned,
      livekit: {
        status: status || 'unreachable',
        urlOk: urlOk === true,
        roomOk: roomOk === true,
        keyPresent: keyPresent === true,
        secretPresent: secretPresent === true,
      },
    });
  });

  router.get('/gains', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const allowed = guard(req, res);
    if (!allowed) return undefined;
    return res.json({
      positionsSlow: allowed.assessment.positionsSlow === true,
      gains: allowed.assessment.gains.map((entry) => ({
        identity: entry.identity,
        gain: entry.gain,
        audible: entry.audible,
        displayName: entry.displayName,
      })),
    });
  });

  return router;
}

module.exports = createVoiceRouter();
module.exports.createVoiceRouter = createVoiceRouter;
