const { sendRcon } = require("./rcon");

async function handler(req, res) {
  try {
    const { command } = req.body || {};
    if (!command) {
      return res.status(400).json({ success: false, error: "Missing command" });
    }

    const result = await sendRcon(command);
    return res.json({ success: true, rcon: result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = handler;