const SLOT_RE = /^[A-Za-z0-9_-]{1,80}$/;

function validateSlot(slot) {
  const value = String(slot || "");
  if (!SLOT_RE.test(value)) throw new Error("Invalid DinoStorage slot");
  return value;
}

function validateSteamId(steamId) {
  const value = String(steamId || "");
  if (!/^\d{17}$/.test(value)) throw new Error("A valid Steam ID is required");
  return value;
}

module.exports = { validateSlot, validateSteamId };
