const { sendRcon } = require("./rcon");

const ALLOWED_COMMAND_PATTERNS = [
  /^listparked$/i,
  /^players$/i,
  /^playerlist$/i,
  /^getplayerdata\s+\d{17}$/i,
];

async function handler(req, res) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Login required" });
    }

    if (!req.user.is_admin) {
      return res.status(403).json({ success: false, error: "Admin access required" });
    }

    const { command } = req.body || {};
    if (!command) {
      return res.status(400).json({ success: false, error: "Missing command" });
    }

    const normalizedCommand = String(command).trim();
    if (!ALLOWED_COMMAND_PATTERNS.some((pattern) => pattern.test(normalizedCommand))) {
      return res.status(400).json({
        success: false,
        error: "Unsupported admin command",
      });
    }

    const result = await sendRcon(normalizedCommand);
    return res.json({ success: true, rcon: result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = handler;