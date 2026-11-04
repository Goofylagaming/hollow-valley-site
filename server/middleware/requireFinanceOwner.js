// Finance is more sensitive than ordinary admin actions. Never authorize via
// is_admin, a Discord role, a username, or an unverified query parameter.
function isFinanceOwner(user, env = process.env) {
  const ownerSteamId = String(env.OWNER_STEAM_ID || "").trim();
  return Boolean(
    /^\d{17}$/.test(ownerSteamId) &&
    user?.steam_id &&
    String(user.steam_id) === ownerSteamId
  );
}

function requireFinanceOwner(req, res, next) {
  res.set("Cache-Control", "private, no-store, max-age=0");
  res.set("Pragma", "no-cache");
  res.set("X-Robots-Tag", "noindex, nofollow");
  res.set("Vary", "Cookie");
  if (!isFinanceOwner(req.user)) {
    // Do not confirm the existence of an owner finance area.
    return res.status(404).json({ error: "Not found" });
  }
  return next();
}

module.exports = { isFinanceOwner, requireFinanceOwner };
