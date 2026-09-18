const { randomUUID } = require('node:crypto');
const store = require('./economyStore');
const files = require('./parkedDinoFileService');

const COLOR_KEYS = Object.freeze([
  'body',
  'markings',
  'flank',
  'underbelly',
  'teeth',
  'mouth',
  'claws',
  'detail1',
  'eyes',
  'maleDisplay',
]);

function systemEnabled() {
  return String(process.env.SKIN_SYSTEM_ENABLED || '').toLowerCase() === 'true';
}

function applyEnabled() {
  return systemEnabled() && String(process.env.PARKED_DINO_EDIT_ENABLED || '').toLowerCase() === 'true';
}

function createCost() {
  const value = Number(process.env.SKIN_PRESET_CREATE_COST || 500);
  return Number.isSafeInteger(value) ? Math.max(1, Math.min(1000000, value)) : 500;
}

function speciesFromClassPath(classPath) {
  const match = /BP_([^./]+?)(?:_C)?(?:\.|$)/i.exec(String(classPath || ''));
  return match ? match[1].replace(/_C$/i, '') : 'Unknown';
}

function validateName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 60) throw new Error('Skin preset name must be between 2 and 60 characters');
  return name;
}

function validateColor(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Skin color ${field} is missing or invalid`);
  }
  const result = {};
  for (const channel of ['r', 'g', 'b', 'a']) {
    const number = Number(value[channel]);
    if (!Number.isFinite(number) || number < 0 || number > 1) {
      throw new Error(`Skin color ${field}.${channel} must be between 0 and 1`);
    }
    result[channel] = number;
  }
  return result;
}

function sanitizeSkin(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Parked dinosaur does not contain captured skin data');
  }

  const skin = {};
  for (const key of COLOR_KEYS) skin[key] = validateColor(value[key], key);

  for (const key of ['skinVariation', 'patternIndex', 'themeIndex']) {
    const number = Number(value[key]);
    if (!Number.isInteger(number) || number < 0 || number > 65535) {
      throw new Error(`Skin ${key} must be a non-negative integer`);
    }
    skin[key] = number;
  }
  return skin;
}

function validateIdempotencyKey(value) {
  const key = String(value || '').trim();
  if (!/^[A-Za-z0-9:_-]{8,160}$/.test(key)) throw new Error('Skin preset idempotency key is invalid');
  return key;
}

function getPresetForPlayer(steamId, presetId) {
  const steam = store.validateSteamId(steamId);
  const preset = store.getSkinPreset(presetId);
  if (!preset || !preset.active || (!preset.isPremium && preset.owner_steam_id !== steam)) {
    const error = new Error('Skin preset not found');
    error.code = 'SKIN_PRESET_NOT_FOUND';
    throw error;
  }
  return preset;
}

function listAvailablePresets(steamId, { species = null } = {}) {
  const steam = store.validateSteamId(steamId);
  return store.listSkinPresets({
    ownerSteamId: steam,
    species,
    includePremium: true,
    activeOnly: true,
    limit: 300,
  });
}

async function createPresetFromStored({ steamId, slot, name, idempotencyKey }) {
  if (!systemEnabled()) {
    const error = new Error('Skin preset system is disabled');
    error.code = 'SKIN_SYSTEM_DISABLED';
    throw error;
  }

  const steam = store.validateSteamId(steamId);
  const selectedSlot = files.validateSlot(slot);
  const presetName = validateName(name);
  const requestKey = validateIdempotencyKey(idempotencyKey);
  const ledgerKey = `skin-preset-create:${requestKey}`;
  const existingTx = store.getLedgerByIdempotency(ledgerKey);
  if (existingTx?.reference_id) {
    const preset = store.getSkinPreset(existingTx.reference_id);
    if (preset) return { duplicate: true, preset, wallet: store.getWallet(steam) };
  }

  const state = await files.readStoredDino(steam, selectedSlot);
  const skin = sanitizeSkin(state.skin);
  const species = speciesFromClassPath(state.classPath);
  const cost = createCost();

  store.db.exec('BEGIN IMMEDIATE');
  try {
    store.ensureWallet(steam);
    const duplicateTx = store.getLedgerByIdempotency(ledgerKey);
    if (duplicateTx?.reference_id) {
      const duplicatePreset = store.getSkinPreset(duplicateTx.reference_id);
      store.db.exec('COMMIT');
      return { duplicate: true, preset: duplicatePreset, wallet: store.getWallet(steam) };
    }

    const wallet = store.db.prepare('SELECT balance FROM economy_wallets WHERE steam_id = ?').get(steam);
    if (Number(wallet.balance) < cost) {
      const error = new Error(`Creating a skin preset costs ${cost} Valley Coin`);
      error.code = 'INSUFFICIENT_FUNDS';
      throw error;
    }

    const presetId = randomUUID();
    store.db.prepare(`
      INSERT INTO economy_skin_presets
        (id, owner_steam_id, species, name, skin_json, is_premium, active)
      VALUES (?, ?, ?, ?, ?, 0, 1)
    `).run(presetId, steam, species, presetName, JSON.stringify(skin));

    store.db.prepare('UPDATE economy_wallets SET balance = ?, updated_at = datetime(\'now\') WHERE steam_id = ?')
      .run(Number(wallet.balance) - cost, steam);
    store.db.prepare(`
      INSERT INTO economy_wallet_ledger
        (id, steam_id, amount, kind, reason, idempotency_key, reference_type, reference_id, metadata_json)
      VALUES (?, ?, ?, 'skin_preset_create', ?, ?, 'skin_preset', ?, ?)
    `).run(
      randomUUID(),
      steam,
      -cost,
      `Created skin preset: ${presetName}`,
      ledgerKey,
      presetId,
      JSON.stringify({ species, sourceSlot: selectedSlot })
    );

    store.db.exec('COMMIT');
    return {
      duplicate: false,
      preset: store.getSkinPreset(presetId),
      wallet: store.getWallet(steam),
    };
  } catch (error) {
    try { store.db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

async function applyPreset({ steamId, slot, presetId }) {
  if (!applyEnabled()) {
    const error = new Error('Applying skins to parked dinosaurs is disabled');
    error.code = 'PARKED_DINO_EDIT_DISABLED';
    throw error;
  }

  const steam = store.validateSteamId(steamId);
  const selectedSlot = files.validateSlot(slot);
  const preset = getPresetForPlayer(steam, presetId);

  const updated = await files.updateStoredDino(steam, selectedSlot, (state) => {
    const targetSpecies = speciesFromClassPath(state.classPath);
    if (targetSpecies.toLowerCase() !== String(preset.species).toLowerCase()) {
      const error = new Error(`This skin preset is for ${preset.species}, not ${targetSpecies}`);
      error.code = 'SKIN_SPECIES_MISMATCH';
      throw error;
    }
    state.skin = JSON.parse(JSON.stringify(preset.skin));
    state.websiteEdits = {
      ...(state.websiteEdits && typeof state.websiteEdits === 'object' ? state.websiteEdits : {}),
      skinAppliedAt: new Date().toISOString(),
      skinPresetId: preset.id,
    };
    return state;
  });

  return {
    preset,
    slot: selectedSlot,
    species: speciesFromClassPath(updated.classPath),
    skin: sanitizeSkin(updated.skin),
  };
}

module.exports = {
  COLOR_KEYS,
  systemEnabled,
  applyEnabled,
  createCost,
  speciesFromClassPath,
  validateName,
  sanitizeSkin,
  listAvailablePresets,
  createPresetFromStored,
  applyPreset,
};
