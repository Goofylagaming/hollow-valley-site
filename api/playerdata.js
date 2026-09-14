const { getState } = require("../server/services/serverStatus");
const { executeGameAction } = require("../server/services/sftpBridge");
const { sendRcon } = require("./rcon.js");

function isRconFailure(result) {
  const normalized = String(result || "").trim().toLowerCase();
  return !normalized || ["error", "failed", "permission", "unknown command", "invalid command"].some((token) => normalized.includes(token));
}

/**
 * Endpoint to fetch a player's dinosaur data via live server status, SFTP bridge, or RCON.
 */
async function handler(req, res) {
  try {
    const steamid = req.query?.steamid || req.query?.steamId || req.body?.steamid || req.user?.steam_id;

    if (!steamid) {
      return res.status(400).json({ error: "Missing SteamID" });
    }

    // 1. Check live server status state first
    const state = getState();
    const activeChar = (state.characters || []).find((c) => c.steamId === String(steamid));

    if (activeChar) {
      return res.json({
        success: true,
        source: "live_status",
        data: activeChar,
      });
    }

    // 2. Try RCON command
    try {
      const rconResult = await sendRcon(`getplayerdata ${steamid}`);
      if (!isRconFailure(rconResult)) {
        return res.json({
          success: true,
          source: "rcon",
          data: rconResult,
        });
      }
    } catch (e) {
      // RCON failed or timed out, fallback to SFTP bridge
    }

    // 3. Fallback to SFTP bridge request
    const bridgeResult = await executeGameAction({
      action: "get_player_data",
      steamId: steamid,
    });

    if (bridgeResult.ok) {
      return res.json({
        success: true,
        source: "sftp_bridge",
        data: bridgeResult.data || bridgeResult,
      });
    }

    // Return current status summary if offline/not spawned
    return res.status(404).json({
      success: false,
      source: "status_summary",
      data: {
        steamId: steamid,
        status: state.online ? "not_spawned_in_game" : "server_offline",
        message: state.online
          ? "No active dinosaur currently spawned in-game on the server."
          : "Game server is currently offline.",
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = handler;
module.exports.default = handler;
