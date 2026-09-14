const { sendRcon } = require("./rcon.js");

/**
 * Endpoint for running admin RCON commands.
 */
async function handler(req, res) {
  try {
    const command = req.body?.command || req.query?.command;

    if (!command) {
      return res.status(400).json({ success: false, error: "Missing command" });
    }

    const result = await sendRcon(command);

    res.json({
      success: true,
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
