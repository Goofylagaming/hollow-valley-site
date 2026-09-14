const { executeGameAction } = require("../server/services/sftpBridge");
const { sendRcon } = require("./rcon.js");

/**
 * Endpoint to list parked dinosaurs via RCON `listparked` with SFTP bridge fallback.
 */
async function handler(req, res) {
  try {
    try {
      const result = await sendRcon("listparked");
      if (result && !result.toLowerCase().includes("unknown command")) {
        return res.json({ success: true, data: result });
      }
    } catch (e) {
      console.warn("[Parked API] RCON listparked failed:", e.message);
    }

    const bridgeResult = await executeGameAction({ action: "list_parked" });
    if (bridgeResult.ok) {
      return res.json({ success: true, data: bridgeResult.data || bridgeResult });
    }

    res.json({
      success: true,
      data: "No parked dinosaur data available from game server.",
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = handler;
module.exports.default = handler;
