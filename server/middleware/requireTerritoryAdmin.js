// Dedicated four-person Territory Wars access gate.
// This is intentionally independent of the broader website admin role.
const ALLOWED_STEAM_IDS = Object.freeze([
  "76561198994993692",
  "76561198137456735", // Chromie
  "76561199141282348", // Defaultguy1
  "76561198038977506",
]);
const allowed = new Set(ALLOWED_STEAM_IDS);

function isAuthorized(user) {
  return Boolean(user?.is_admin && allowed.has(String(user?.steam_id || "")));
}
function requireTerritoryAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Login required" });
  if (!isAuthorized(req.user)) return res.status(403).json({ error: "Territory Wars admin access required" });
  return next();
}
module.exports = { ALLOWED_STEAM_IDS, isAuthorized, requireTerritoryAdmin };
