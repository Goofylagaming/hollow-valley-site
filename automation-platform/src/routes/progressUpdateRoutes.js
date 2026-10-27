'use strict';

// Dedicated, least-privilege ingestion for GitHub release notes. This endpoint
// can enqueue Discord progress updates, but has no access to game or wallet writes.
const express = require('express');
const { timingSafeEqual } = require('node:crypto');
const herbyBot = require('../services/herbyBotOutboxService');

const STAGES = Object.freeze({
  building: '🛠️ In Development',
  testing: '🧪 Testing',
  blocked: '⛔ Blocked',
  ready: '📦 Ready to Deploy',
  live: '✅ Live',
  fixed: '🔧 Fix Released',
});

const SCOPES = Object.freeze({
  website: 'Website',
  automation: 'Automation',
  both: 'Website + Automation',
  general: 'Hollow Valley Project',
});

const REFERENCE_PATTERN = /^https:\/\/github\.com\/Goofylagaming\/hollow-valley-site\/(?:pull\/[1-9]\d*|commit\/[0-9a-f]{40}|actions\/runs\/[1-9]\d*)\/?$/;

function constantTimeEqual(a, b) {
  const actual = Buffer.from(String(a || ''), 'utf8');
  const expected = Buffer.from(String(b || ''), 'utf8');
  return actual.length > 0 && actual.length === expected.length && timingSafeEqual(actual, expected);
}

function requireProgressToken(req, res, next) {
  const expected = String(process.env.HV_DISCORD_PROGRESS_TOKEN || '').trim();
  if (!expected) return res.status(503).json({ error: 'Progress update integration is not configured.' });
  const authorization = String(req.get('authorization') || '');
  const bearer = /^Bearer\s+([^\s]+)$/i.exec(authorization)?.[1] || '';
  if (!constantTimeEqual(bearer, expected)) return res.status(401).json({ error: 'Unauthorized progress update.' });
  return next();
}

function cleanLine(value, label, maxLength) {
  const result = String(value ?? '').replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!result || result.length > maxLength) throw new Error(label + ' is required and must be ' + maxLength + ' characters or fewer.');
  // Disable Discord markdown spoofing, mass mentions and link/autocomplete syntax.
  return result.replace(/([\\*_~|\x60>])/g, '\\$1').replace(/@/g, '@\u200b').replace(/</g, '‹');
}

function validateProgressUpdate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Update body must be an object.');

  const stage = String(body.stage || '').trim();
  if (!Object.hasOwn(STAGES, stage)) throw new Error('Invalid progress stage.');

  const scope = String(body.scope || 'general').trim();
  if (!Object.hasOwn(SCOPES, scope)) throw new Error('Invalid progress scope.');

  const milestone = cleanLine(body.milestone || 'Hollow Valley', 'Milestone', 48);
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,47}$/.test(milestone)) throw new Error('Invalid milestone label.');

  const summary = cleanLine(body.summary, 'Summary', 350);
  const reference = String(body.reference || '').trim();
  if (!REFERENCE_PATTERN.test(reference)) throw new Error('Reference must be a Hollow Valley GitHub commit, pull request or workflow.');

  const nonce = String(body.nonce || '').trim();
  if (!/^hv-progress:(?:release|manual):[A-Za-z0-9:_-]{6,100}$/.test(nonce) || nonce.length > 128) {
    throw new Error('Invalid idempotency key.');
  }
  return { stage, scope, milestone, summary, reference, nonce };
}

function formatProgressUpdate(input) {
  return [
    '🦖 **Hollow Valley — Server Progress & Updates**',
    '**Status:** ' + STAGES[input.stage],
    '**Milestone:** ' + input.milestone,
    '**Area:** ' + SCOPES[input.scope],
    '**Changes:** ' + input.summary,
    '**GitHub:** ' + input.reference,
  ].join('\n');
}

function createProgressUpdateRouter({ queueProgress = herbyBot.queueProgress } = {}) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    return requireProgressToken(req, res, next);
  });

  router.post('/', (req, res) => {
    let update;
    try {
      update = validateProgressUpdate(req.body);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    const message = formatProgressUpdate(update);
    try {
      const event = queueProgress(message, { nonce: update.nonce });
      if (event?.destination !== 'progress' || event?.message !== message) {
        return res.status(409).json({ error: 'This update key is already associated with a different message.' });
      }
      return res.status(202).json({
        ok: true,
        queued: !['delivered', 'failed'].includes(event.status),
        eventId: event.id,
        deliveryStatus: event.status,
      });
    } catch {
      return res.status(503).json({ error: 'Progress update could not be queued.' });
    }
  });

  return router;
}

module.exports = createProgressUpdateRouter();
module.exports.createProgressUpdateRouter = createProgressUpdateRouter;
module.exports.validateProgressUpdate = validateProgressUpdate;
module.exports.formatProgressUpdate = formatProgressUpdate;
module.exports.requireProgressToken = requireProgressToken;
