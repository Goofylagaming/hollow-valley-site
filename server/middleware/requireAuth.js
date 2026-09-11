function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Not logged in" });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Not logged in" });
  if (!req.user.is_admin) return res.status(403).json({ error: "Admin access required" });
  next();
}

module.exports = { requireAuth, requireAdmin };
