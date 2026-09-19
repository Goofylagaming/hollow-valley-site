const crypto = require('node:crypto');

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function requireHerbyBotToken(req, res, next) {
  const expected = String(process.env.HERBYBOT_AUTOMATION_TOKEN || '').trim();
  if (!expected) {
    return res.status(503).json({ error: 'HerbyBot bridge is disabled until HERBYBOT_AUTOMATION_TOKEN is configured.' });
  }

  const authorization = String(req.get('authorization') || '');
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const supplied = bearer || String(req.get('x-herbybot-token') || '').trim();
  if (!safeEqual(supplied, expected)) {
    return res.status(401).json({ error: 'Unauthorized HerbyBot bridge request.' });
  }
  next();
}

module.exports = { requireHerbyBotToken };
