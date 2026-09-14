const { sendRcon } = require("./rcon");

const COMMANDS = ["spawnparked", "loadparked", "restore", "spawn"];

async function handler(req, res) {
  try {
    const { steamid } = req.body || {};
    if (!steamid) {
      return res.status(400).json({ success: false, error: "Missing SteamID" });
    }

    for (const cmd of COMMANDS) {
      const result = await sendRcon(`${cmd} ${steamid}`);
      if (
        result &&
        !result.toLowerCase().includes("unknown") &&
        !result.toLowerCase().includes("invalid")
      ) {
        return res.json({
          success: true,
          message: `Redeemed using: ${cmd}`,
          rcon: result,
        });
      }
    }

    return res.json({ success: false, error: "No redeem command worked." });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = handler;