const { runDinoStorageAction } = require("../server/services/dinoStorage");

function isRconFailure(result) {
  const normalized = String(result || "").trim().toLowerCase();
  return !normalized || ["error", "failed", "permission", "unknown command", "invalid command"].some((token) => normalized.includes(token));
}

/**
 * Endpoint to redeem a player's dinosaur through DinoStorage.
 */
async function handler(req, res) {
  try {
    const steamid = req.body?.steamid || req.body?.steamId || req.query?.steamid || req.user?.steam_id;

    if (!steamid) {
      return res.status(400).json({ error: "Missing SteamID" });
    }

    const result = await runDinoStorageAction("redeem", steamid);
    return res.json({
      success: true,
      message: "DinoStorage redeem command sent.",
      data: result,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}

module.exports = handler;
module.exports.default = handler;
