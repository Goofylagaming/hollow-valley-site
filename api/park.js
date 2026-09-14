const { sendRcon } = require("./rcon");

async function handler(req, res) {
  try {
    const { steamid } = req.body || {};
    if (!steamid) {
      return res.status(400).json({ success: false, error: "Missing SteamID" });
    }

    const result = await sendRcon(`park ${steamid}`);
    return res.json({ success: true, rcon: result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = handler;