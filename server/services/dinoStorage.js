const { randomUUID } = require("node:crypto");
const commandBridge = require("./commandBridge");
const storageFiles = require("./dinoStorageFiles");

function createSlotId() {
  return `dino-${randomUUID()}`;
}

async function runDinoStorageAction(action, steamId, slot) {
  const verbs = { store: "dino_store", redeem: "dino_retrieve" };
  if (!Object.hasOwn(verbs, action)) throw new Error("Unsupported DinoStorage action");

  const selectedSlot = storageFiles.validateSlot(slot || "default");

  const resultMode = (process.env.DINOSTORAGE_RESULT_MODE || "submod").trim();
  const result = await commandBridge.executeCommand(
    verbs[action],
    String(steamId || ""),
    [selectedSlot],
    { resultMode }
  );

  if (result.ok && !result.queued) {
    const deferred = action === "store" ? "kill" : "restore";
    result.message = `${result.message} DinoStorage accepted the action; its deferred in-game ${deferred} is not independently confirmed.`;
  }

  return {
    ...result,
    action,
    slot: selectedSlot,
    completionConfirmed: false,
  };
}

async function respondToDinoStorageAction(req, res, action, slot) {
  if (!req.user) return res.status(401).json({ error: "Not logged in" });
  if (!req.user.steam_id) {
    return res.status(400).json({ error: "Your Steam account is not linked. Please sign in with Steam first." });
  }

  try {
    const result = await runDinoStorageAction(action, req.user.steam_id, slot);
    if (!result.ok && !result.queued) return res.status(502).json({ error: result.error, result });
    return res.status(result.queued ? 202 : 200).json({
      ok: result.ok,
      action,
      slot: result.slot,
      message: result.message,
      result,
    });
  } catch (err) {
    console.error("[DinoStorage]", { action, slot, error: err.message });
    return res.status(502).json({ error: `DinoStorage command failed: ${err.message}` });
  }
}

module.exports = {
  createSlotId,
  listStoredDinos: storageFiles.listStoredDinos,
  runDinoStorageAction,
  respondToDinoStorageAction,
};
