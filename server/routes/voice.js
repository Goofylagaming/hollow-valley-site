'use strict';

const express = require('express');
const { assessVoice, unitsPerMeter, voiceEnabled } = require('../services/voiceProximity');
const { mintLiveKitToken } = require('../services/voiceToken');

const STEAM_ID = /^\d{17}$/;

function expectedOrigin(req, env) {
  if (env.PUBLIC_SITE_URL) return new URL(env.PUBLIC_SITE_URL).origin;
  return `${req.protocol}://${req.get('host')}`;
}

function fail(res, status, code, error) {
  return res.status(status).json({ error, code });
}

function createVoiceRouter({ getState, mintToken, env, now } = {}) {
  const router = express.Router();
  const readState = getState || (() => require('../services/serverStatus').getState());
  const mint = mintToken || mintLiveKitToken;
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
      fail(res, 503, 'VOICE_OFFLINE', 'Voice is offline.');
      return null;
    }
    const assessment = assessVoice(readState(), steamId, { nowMs: nowMs(), unitsPerMeter: scale });
    if (!assessment.ok) {
      if (assessment.reason === 'not_on_server') {
        fail(res, 403, 'NOT_ON_SERVER', 'You are not on the Hollow Valley server right now.');
      } else {
        fail(res, 503, 'VOICE_OFFLINE', 'Voice is offline.');
      }
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
      });
    } catch {
      console.warn('[voice] token mint failed');
      return fail(res, 503, 'VOICE_OFFLINE', 'Voice is offline.');
    }
  });

  router.get('/gains', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const allowed = guard(req, res);
    if (!allowed) return undefined;
    return res.json({
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
