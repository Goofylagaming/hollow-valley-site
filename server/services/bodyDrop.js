const fileBridge = require("./sftpBridge");
const commandBridge = require("./commandBridge");

async function executeBodyDrop(options) {
  const mode = (process.env.BODYDROP_BRIDGE_MODE || "commandbridge").trim();
  if (mode === "legacy") return fileBridge.executeGameAction({ ...options, action: "body_drop" });
  if (mode !== "commandbridge") return { ok: false, error: "BODYDROP_BRIDGE_MODE must be commandbridge or legacy" };
  try {
    const job = fileBridge.buildBodyDropJob(options);
    return await commandBridge.executeCommand("bd", job.steamId, [
      "spawn", job.species, String(job.x), String(job.y), String(job.z), String(job.growth), job.steamId,
    ], { onPrepared: options.onPrepared });
  } catch (err) {
    console.error("[Body Drop]", { error: err.message });
    return { ok: false, error: err.message };
  }
}

module.exports = { executeBodyDrop };
