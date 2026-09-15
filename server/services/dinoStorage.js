const { sendRcon } = require("../../api/rcon");

function commandFromEnv(name, fallback) {
  const value = String(process.env[name] || fallback).trim();
  if (!value || /[\r\n]/.test(value)) {
    throw new Error(`${name} must be a single non-empty command`);
  }
  return value;
}

function buildCommand(name, fallback, steamId) {
  const template = commandFromEnv(name, fallback);
  const id = String(steamId || "").trim();
  if (!/^\d{17}$/.test(id)) throw new Error("A valid Steam ID is required");
  return template.replace(/\{steamId\}/gi, id);
}

async function runDinoStorageAction(action, steamId) {
  const config = action === "store"
    ? ["DINOSTORAGE_STORE_COMMAND", "!store"]
    : ["DINOSTORAGE_REDEEM_COMMAND", "!redeem"];
  const command = buildCommand(config[0], config[1], steamId);
  const prefix = String(process.env.DINOSTORAGE_RCON_PREFIX || "").trim();
  const rconCommand = `${prefix}${command}`.trim();
  const response = await sendRcon(rconCommand);
  return { action, command: rconCommand, response };
}

module.exports = { runDinoStorageAction, buildCommand };
