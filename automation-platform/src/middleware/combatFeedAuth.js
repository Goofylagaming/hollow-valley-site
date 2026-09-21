const crypto = require('node:crypto');

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function requireCombatFeedToken(req, res, next) {
  if (String(process.env.COMBAT_FEED_ENABLED || '').toLowerCase() !== 'true') {
    return res.status(503).json({
      error: 'Authoritative combat ingestion is disabled.',
      code: 'COMBAT_FEED_DISABLED',
    });
  }

  const expected = String(process.env.COMBAT_FEED_TOKEN || '').trim();
  if (!expected) {
    return res.status(503).json({
      error: 'Combat ingestion is not configured.',
      code: 'COMBAT_FEED_NOT_CONFIGURED',
    });
  }

  const authorization = String(req.get('authorization') || '');
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const supplied = bearer || String(req.get('x-combat-feed-token') || '').trim();
  if (!safeEqual(supplied, expected)) {
    return res.status(401).json({ error: 'Unauthorized combat feed request.' });
  }
  next();
}

module.exports = { requireCombatFeedToken };
