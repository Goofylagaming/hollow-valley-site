const { executeGameAction } = require("../server/services/sftpBridge");
const { sendRcon } = require("./rcon.js");

/**
 * Endpoint to redeem/unpark a player's dinosaur.
 * Auto-detects supported command: spawnparked, loadparked, restore, or spawn, with SFTP bridge fallback.
 */
async function handler(req, res) {
  try {
    const steamid = req.body?.steamid || req.body?.steamId || req.query?.steamid || req.user?.steam_id;

    if (!steamid) {
      return res.status(400).json({ error: "Missing SteamID" });
    }

    const candidateCommands = [
      `spawnparked ${steamid}`,
      `loadparked ${steamid}`,
      `restore ${steamid}`,
      `spawn ${steamid}`,
    ];

    let lastRconError = null;
    let rconResult = null;

    // 1. Try RCON candidates sequentially
    for (const cmd of candidateCommands) {
      try {
        const result = await sendRcon(cmd);
        if (result && !result.toLowerCase().includes("unknown command") && !result.toLowerCase().includes("invalid command")) {
          return res.json({
            success: true,
            message: "Dino redeemed successfully via RCON",
            command: cmd,
            rcon: result,
          });
        }
        rconResult = result;
      } catch (rconErr) {
        lastRconError = rconErr;
      }
    }

    // 2. Try SFTP Bridge fallback
    const bridgeResult = await executeGameAction({
      action: "redeem",
      steamId: steamid,
    });

    if (bridgeResult.ok) {
      return res.json({
        success: true,
        message: "Dino redeemed successfully via SFTP bridge",
        data: bridgeResult,
      });
    }

    res.status(400).json({
      success: false,
      error: bridgeResult.error || (rconResult ? `RCON response: ${rconResult}` : lastRconError?.message || "Failed to redeem dinosaur on game server."),
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
