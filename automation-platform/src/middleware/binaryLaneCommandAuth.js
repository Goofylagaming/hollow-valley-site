const crypto = require('node:crypto');

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function requireBinaryLaneCommandToken(req, res, next) {
  const expected = String(process.env.BINARYLANE_COMMAND_TOKEN || '').trim();
  if (!expected) {
    return res.status(503).json({
      error: 'BinaryLane command bridge is not configured.',
      code: 'BINARYLANE_COMMAND_BRIDGE_NOT_CONFIGURED',
    });
  }

  const authorization = String(req.get('authorization') || '');
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const supplied = bearer || String(req.get('x-binarylane-command-token') || '').trim();

  if (!safeEqual(supplied, expected)) {
    return res.status(401).json({ error: 'Unauthorized BinaryLane command bridge request.' });
  }

  next();
}

module.exports = { requireBinaryLaneCommandToken };
