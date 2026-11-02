'use strict';
const express = require('express');
const crypto = require('node:crypto');
const nativeGroups = require('../services/nativeGroupMembershipService');
const router = express.Router();

function equalsSecret(provided, expected) {
  if (!provided || !expected) return false;
  return crypto.timingSafeEqual(
    crypto.createHash('sha256').update(provided).digest(),
    crypto.createHash('sha256').update(expected).digest()
  );
}

router.post('/snapshot', (req, res) => {
  res.set('Cache-Control', 'no-store, private');
  if (!nativeGroups.enabled()) return res.status(404).json({ error: 'Not found' });
  const expected = String(process.env.GROUPMATES_FEED_TOKEN || '').trim();
  if (expected.length < 32) return res.status(503).json({ error: 'Group feed is not configured.' });
  const bearer = String(req.get('authorization') || '').match(/^Bearer\s+(\S+)$/i)?.[1] || '';
  if (!equalsSecret(bearer, expected)) return res.status(401).json({ error: 'Unauthorized group feed.' });
  try {
    const result = nativeGroups.ingest(req.body);
    return res.status(result.duplicate ? 200 : 201).json({ ok: true, duplicate: result.duplicate });
  } catch (error) {
    return res.status(error.status || 400).json({
      error: error.code === 'GROUP_SAMPLE_CONFLICT' ? 'Group sample conflict.' : 'Invalid group sample.',
      code: error.code || 'GROUP_SAMPLE_INVALID',
    });
  }
});

module.exports = router;
