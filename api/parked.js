const { executeGameAction } = require("../server/services/sftpBridge");
const { sendRcon } = require("./rcon.js");

function isRconFailure(result) {
  const normalized = String(result || "").trim().toLowerCase();
  return !normalized || ["error", "failed", "permission", "unknown command", "invalid command"].some((token) => normalized.includes(token));
}

/**
 * Endpoint to list parked dinosaurs via RCON `listparked` with SFTP bridge fallback.
 */
async function handler(req, res) {
  try {
    try {
      const result = await sendRcon("listparked");
      if (!isRconFailure(result)) {
        return res.json({ success: true, data: result });
      }
    } catch (e) {
      console.warn("[Parked API] RCON listparked failed:", e.message);
    }

    const bridgeResult = await executeGameAction({ action: "list_parked" });
    if (bridgeResult.ok) {
      return res.json({ success: true, data: bridgeResult.data || bridgeResult });
    }

    return res.status(502).json({
      success: false,
      error: bridgeResult.error || "No parked dinosaur data available from game server.",
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = handler;
module.exports.default = handler;
