const { respondToDinoStorageAction } = require("../server/services/dinoStorage");

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST for DinoStorage actions" });
  return respondToDinoStorageAction(req, res, "store");
}

module.exports = handler;
module.exports.default = handler;
