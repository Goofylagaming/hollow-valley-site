const { sendRcon } = require("./rcon.js");

/**
 * Endpoint to park a player's active dinosaur via RCON command `park <steamid>`.
 */
async function handler(req, res) {
  try {
    const steamid = req.body?.steamid || req.body?.steamId || req.query?.steamid || req.user?.steam_id;

    if (!steamid) {
      return res.status(400).json({ error: "Missing SteamID" });
    }

    const result = await sendRcon(`park ${steamid}`);

    res.json({
      success: true,
      message: "Dino parked successfully",
      rcon: result,
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
