const crypto = require('node:crypto');

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length || !left.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function requireAdminToken(req, res, next) {
  const expected = String(process.env.AUTOMATION_ADMIN_TOKEN || '').trim();
  if (!expected) {
    return res.status(503).json({ error: 'Automation write API is disabled until AUTOMATION_ADMIN_TOKEN is configured.' });
  }

  const authorization = String(req.get('authorization') || '');
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const supplied = bearer || String(req.get('x-automation-token') || '').trim();
  if (!safeEqual(supplied, expected)) {
    return res.status(401).json({ error: 'Unauthorized automation request.' });
  }
  next();
}

module.exports = { requireAdminToken };
