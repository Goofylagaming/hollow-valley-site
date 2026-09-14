const { executeGameAction } = require("../server/services/sftpBridge");
const { sendRcon } = require("./rcon.js");

function isRconFailure(result) {
  const normalized = String(result || "").trim().toLowerCase();
  return !normalized || ["error", "unknown command", "invalid command"].some((token) => normalized.includes(token));
}

/**
 * Endpoint to park a player's active dinosaur via RCON command `park <steamid>` with SFTP bridge fallback.
 */
async function handler(req, res) {
  try {
    const steamid = req.body?.steamid || req.body?.steamId || req.query?.steamid || req.user?.steam_id;

    if (!steamid) {
      return res.status(400).json({ error: "Missing SteamID" });
    }

    // 1. Try RCON command first
    try {
      const result = await sendRcon(`park ${steamid}`);
      if (isRconFailure(result)) {
        throw new Error(typeof result === "string" && result.trim() ? result.trim() : "RCON park command failed");
      }

      return res.json({
        success: true,
        message: "Dino parked successfully via RCON",
        rcon: result,
      });
    } catch (rconErr) {
      console.warn("[Park API] RCON failed, attempting SFTP bridge fallback:", rconErr.message);
    }

    // 2. Try SFTP Bridge fallback
    const bridgeResult = await executeGameAction({
      action: "park",
      steamId: steamid,
    });

    if (bridgeResult.ok) {
      return res.json({
        success: true,
        message: "Dino parked successfully via SFTP bridge",
        data: bridgeResult,
      });
    }

    res.status(400).json({
      success: false,
      error: bridgeResult.error || "Failed to park dino on game server. Ensure player is spawned in-game.",
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
