const { sendRcon } = require("./rcon.js");

/**
 * Endpoint to fetch a player's dinosaur data via RCON command `getplayerdata <steamid>`.
 */
async function handler(req, res) {
  try {
    const steamid = req.query?.steamid || req.query?.steamId || req.body?.steamid || req.user?.steam_id;

    if (!steamid) {
      return res.status(400).json({ error: "Missing SteamID" });
    }

    const result = await sendRcon(`getplayerdata ${steamid}`);

    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = handler;
module.exports.default = handler;
