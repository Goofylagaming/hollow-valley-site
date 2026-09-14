const { sendRcon } = require("./rcon");

async function handler(req, res) {
  try {
    const result = await sendRcon("listparked");
    return res.json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = handler;