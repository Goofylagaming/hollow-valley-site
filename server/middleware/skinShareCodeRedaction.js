function redactShareCodes(value) {
  if (Array.isArray(value)) return value.map(redactShareCodes);
  if (!value || typeof value !== 'object') return value;

  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'share_code' || key === 'shareCode') {
      output[key] = null;
      continue;
    }
    output[key] = redactShareCodes(entry);
  }
  return output;
}

function skinShareCodeRedaction(req, res, next) {
  if (req.user?.is_admin) return next();
  const originalJson = res.json.bind(res);
  res.json = (payload) => originalJson(redactShareCodes(payload));
  return next();
}

module.exports = { skinShareCodeRedaction, redactShareCodes };
