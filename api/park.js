const { runDinoStorageAction } = require("../server/services/dinoStorage");

/**
 * Endpoint to store a player's active dinosaur through DinoStorage.
 */
async function handler(req, res) {
  try {
    const steamid = req.body?.steamid || req.body?.steamId || req.query?.steamid || req.user?.steam_id;

    if (!steamid) {
      return res.status(400).json({ error: "Missing SteamID" });
    }

    const result = await runDinoStorageAction("store", steamid);
    return res.json({
      success: true,
      message: "DinoStorage store command sent.",
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
