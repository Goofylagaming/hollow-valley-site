const crypto = require('node:crypto');

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function requirePresenceFeedToken(req, res, next) {
  const expected = String(process.env.PRESENCE_FEED_TOKEN || '').trim();
  if (!expected) {
    return res.status(503).json({
      error: 'External presence ingestion is not configured.',
      code: 'PRESENCE_FEED_NOT_CONFIGURED',
    });
  }

  const authorization = String(req.get('authorization') || '');
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const supplied = bearer || String(req.get('x-presence-feed-token') || '').trim();
  if (!safeEqual(supplied, expected)) {
    return res.status(401).json({ error: 'Unauthorized presence feed request.' });
  }
  next();
}

module.exports = { requirePresenceFeedToken };
