const commandBridge = require("./commandBridge");

async function runDinoStorageAction(action, steamId) {
  const verbs = { store: "dino_store", redeem: "dino_retrieve" };
  if (!Object.hasOwn(verbs, action)) throw new Error("Unsupported DinoStorage action");
  const resultMode = (process.env.DINOSTORAGE_RESULT_MODE || "submod").trim();
  const result = await commandBridge.executeCommand(verbs[action], String(steamId || ""), ["default"], { resultMode });
  if (result.ok && !result.queued) {
    result.message = `${result.message} DinoStorage accepted the action; its deferred in-game ${action === "store" ? "kill" : "restore"} is not independently confirmed.`;
  }
  return { ...result, action, completionConfirmed: false };
}

async function respondToDinoStorageAction(req, res, action) {
  if (!req.user) return res.status(401).json({ error: "Not logged in" });
  if (!req.user.steam_id) {
    return res.status(400).json({ error: "Your Steam account is not linked. Please sign in with Steam first." });
  }
  try {
    const result = await runDinoStorageAction(action, req.user.steam_id);
    if (!result.ok && !result.queued) return res.status(502).json({ error: result.error, result });
    return res.status(result.queued ? 202 : 200).json({ ok: result.ok, action, message: result.message, result });
  } catch (err) {
    console.error("[DinoStorage]", { action, error: err.message });
    return res.status(502).json({ error: `DinoStorage command failed: ${err.message}` });
  }
}

module.exports = { runDinoStorageAction, respondToDinoStorageAction };
