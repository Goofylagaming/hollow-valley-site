const { randomBytes, randomUUID } = require('node:crypto');
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

function liveWearEnabled() {
  return systemEnabled() && String(process.env.SKIN_LIVE_WEAR_ENABLED || '').toLowerCase() === 'true';
}

function createCost() {
  const value = Number(process.env.SKIN_PRESET_CREATE_COST || 0);
  return Number.isSafeInteger(value) ? Math.max(0, Math.min(1000000, value)) : 0;
}

function speciesFromClassPath(classPath) {
  const match = /BP_([^./]+?)(?:_C)?(?:\.|$)/i.exec(String(classPath || ''));
  return match ? match[1].replace(/_C$/i, '') : 'Unknown';
}

function validateSpecies(value) {
  const species = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{2,64}$/.test(species)) {
    throw new Error('Skin species is invalid');
  }
  return species;
}

function validateName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 60) throw new Error('Skin preset name must be between 2 and 60 characters');
  return name;
}

function validateDescription(value) {
  const description = String(value || '').trim().replace(/\s+/g, ' ');
  if (description.length > 240) throw new Error('Skin description must be 240 characters or fewer');
  return description;
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
    throw new Error('Skin data is missing or invalid');
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

function generateShareCode() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const raw = randomBytes(5).toString('hex').toUpperCase();
    const code = `HV-${raw.slice(0, 5)}-${raw.slice(5)}`;
    if (!store.getSkinPresetByShareCode(code)) return code;
  }
  throw new Error('Could not generate a unique skin share code');
}

function getPresetForPlayer(steamId, presetId) {
  const steam = store.validateSteamId(steamId);
  const preset = store.getSkinPreset(presetId);
  const grant = preset ? store.getSkinGrant(steam, preset.id) : null;
  const accessible = preset && preset.active && (
    preset.owner_steam_id === steam ||
    preset.isPremium ||
    Number(preset.price) === 0 && preset.published ||
    store.hasSkinUnlock(steam, preset.id) ||
    Boolean(grant)
  );
  if (!accessible) {
    const error = new Error('Skin preset not found or not unlocked');
    error.code = 'SKIN_PRESET_NOT_FOUND';
    throw error;
  }

  if (grant?.customized_at) {
    let customSkin = preset.skin;
    try {
      customSkin = sanitizeSkin(JSON.parse(grant.custom_skin_json || '{}'));
    } catch {}
    return {
      ...preset,
      species: grant.custom_species || preset.species,
      name: grant.custom_name || preset.name,
      description: grant.custom_description ?? preset.description,
      skin: customSkin,
      owned: true,
      granted: true,
      grantCustomized: true,
      grantNote: grant.note || '',
      grantedAt: grant.granted_at || null,
      customizedAt: grant.customized_at || null,
    };
  }

  return {
    ...preset,
    owned: true,
    granted: Boolean(grant),
    grantCustomized: false,
    grantNote: grant?.note || '',
    grantedAt: grant?.granted_at || null,
  };
}

function listAvailablePresets(steamId, { species = null } = {}) {
  const steam = store.validateSteamId(steamId);
  const wanted = species ? validateSpecies(species).toLowerCase() : null;
  return store.listOwnedSkinPresets(steam, { limit: 300 })
    .filter((preset) => !wanted || String(preset.species).toLowerCase() === wanted || String(preset.species).toLowerCase() === 'universal');
}

function listStore(steamId = null, { species = null } = {}) {
  return store.listSkinStore({
    steamId: steamId ? store.validateSteamId(steamId) : null,
    species: species ? validateSpecies(species) : null,
    limit: 300,
  });
}

function getSharedPreset(shareCode) {
  const preset = store.getSkinPresetByShareCode(shareCode);
  if (!preset || !preset.active || preset.exclusive) {
    const error = new Error('Skin share code not found');
    error.code = 'SKIN_SHARE_NOT_FOUND';
    throw error;
  }
  return preset;
}

function createPresetRecord({ ownerSteamId, species, name, description = '', skin, createKey = null }) {
  const owner = ownerSteamId ? store.validateSteamId(ownerSteamId) : null;
  if (owner) store.ensureWallet(owner);
  const id = randomUUID();
  const shareCode = generateShareCode();
  store.db.prepare(`
    INSERT INTO economy_skin_presets
      (id, owner_steam_id, species, name, description, skin_json, is_premium, active, published, price, share_code, create_key)
    VALUES (?, ?, ?, ?, ?, ?, 0, 1, 0, 0, ?, ?)
  `).run(
    id,
    owner,
    validateSpecies(species),
    validateName(name),
    validateDescription(description),
    JSON.stringify(sanitizeSkin(skin)),
    shareCode,
    createKey
  );
  return store.getSkinPreset(id);
}

async function createPresetFromStudio({ steamId, species, name, description = '', skin, idempotencyKey }) {
  if (!systemEnabled()) {
    const error = new Error('Skin preset system is disabled');
    error.code = 'SKIN_SYSTEM_DISABLED';
    throw error;
  }

  const steam = store.validateSteamId(steamId);
  const requestKey = validateIdempotencyKey(idempotencyKey);
  const createKey = `skin-studio:${steam}:${requestKey}`;
  const existing = store.getSkinPresetByCreateKey(createKey);
  if (existing) return { duplicate: true, preset: existing, wallet: store.getWallet(steam) };

  const preset = createPresetRecord({
    ownerSteamId: steam,
    species,
    name,
    description,
    skin,
    createKey,
  });
  return { duplicate: false, preset, wallet: store.getWallet(steam) };
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
  const createKey = `skin-stored:${steam}:${requestKey}`;
  const existingPreset = store.getSkinPresetByCreateKey(createKey);
  if (existingPreset) return { duplicate: true, preset: existingPreset, wallet: store.getWallet(steam) };

  const state = await files.readStoredDino(steam, selectedSlot);
  const skin = sanitizeSkin(state.skin);
  const species = speciesFromClassPath(state.classPath);
  const cost = createCost();

  store.db.exec('BEGIN IMMEDIATE');
  try {
    store.ensureWallet(steam);
    const duplicatePreset = store.getSkinPresetByCreateKey(createKey);
    if (duplicatePreset) {
      store.db.exec('COMMIT');
      return { duplicate: true, preset: duplicatePreset, wallet: store.getWallet(steam) };
    }

    const wallet = store.db.prepare('SELECT balance FROM economy_wallets WHERE steam_id = ?').get(steam);
    if (Number(wallet.balance) < cost) {
      const error = new Error(`Creating a skin preset costs ${cost} Valley Coin`);
      error.code = 'INSUFFICIENT_FUNDS';
      throw error;
    }

    const preset = createPresetRecord({
      ownerSteamId: steam,
      species,
      name: presetName,
      skin,
      createKey,
    });

    if (cost > 0) {
      const ledgerKey = `skin-preset-create:${requestKey}`;
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
        preset.id,
        JSON.stringify({ species, sourceSlot: selectedSlot })
      );
    }

    store.db.exec('COMMIT');
    return {
      duplicate: false,
      preset: store.getSkinPreset(preset.id),
      wallet: store.getWallet(steam),
    };
  } catch (error) {
    try { store.db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

function publishPreset({ presetId, price = 0, description = '', published = true }) {
  const preset = store.getSkinPreset(presetId);
  if (!preset) {
    const error = new Error('Skin preset not found');
    error.code = 'SKIN_PRESET_NOT_FOUND';
    throw error;
  }
  if (preset.exclusive && published) {
    const error = new Error('Exclusive skins cannot be published in the public Skin Shop');
    error.code = 'SKIN_EXCLUSIVE';
    throw error;
  }
  const amount = Number(price);
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1000000) {
    throw new Error('Skin price must be a whole number between 0 and 1,000,000');
  }
  const desc = validateDescription(description || preset.description || '');
  store.db.prepare(`
    UPDATE economy_skin_presets
    SET published = ?, price = ?, description = ?, is_premium = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(published ? 1 : 0, amount, desc, published && amount === 0 ? 1 : 0, preset.id);
  return store.getSkinPreset(preset.id);
}

function grantExclusivePreset({ presetId, steamId, grantedBySteamId = null, note = '' }) {
  if (!systemEnabled()) {
    const error = new Error('Skin preset system is disabled');
    error.code = 'SKIN_SYSTEM_DISABLED';
    throw error;
  }
  const preset = store.getSkinPreset(presetId);
  if (!preset || !preset.active) {
    const error = new Error('Skin preset not found');
    error.code = 'SKIN_PRESET_NOT_FOUND';
    throw error;
  }
  return store.grantSkinPreset({
    steamId,
    presetId: preset.id,
    grantedBySteamId,
    note,
  });
}

function revokeExclusiveGrant({ presetId, steamId }) {
  const preset = store.getSkinPreset(presetId);
  if (!preset || !preset.active) {
    const error = new Error('Skin preset not found');
    error.code = 'SKIN_PRESET_NOT_FOUND';
    throw error;
  }
  return store.revokeSkinGrant({ steamId, presetId: preset.id });
}

function listExclusiveGrants(presetId) {
  const preset = store.getSkinPreset(presetId);
  if (!preset || !preset.active) {
    const error = new Error('Skin preset not found');
    error.code = 'SKIN_PRESET_NOT_FOUND';
    throw error;
  }
  return {
    preset,
    grants: store.listSkinGrants(preset.id),
  };
}

function updatePreset({ steamId, presetId, species, name, description = '', skin }) {
  const steam = store.validateSteamId(steamId);
  const preset = store.getSkinPreset(presetId);
  if (!preset || !preset.active) {
    const error = new Error('Skin preset not found');
    error.code = 'SKIN_PRESET_NOT_FOUND';
    throw error;
  }

  const safeSpecies = validateSpecies(species);
  const safeName = validateName(name);
  const safeDescription = validateDescription(description);
  const safeSkin = sanitizeSkin(skin);

  if (preset.owner_steam_id === steam) {
    store.db.prepare(`
      UPDATE economy_skin_presets
      SET species = ?, name = ?, description = ?, skin_json = ?, updated_at = datetime('now')
      WHERE id = ? AND owner_steam_id = ? AND active = 1
    `).run(safeSpecies, safeName, safeDescription, JSON.stringify(safeSkin), preset.id, steam);
    return store.getSkinPreset(preset.id);
  }

  const grant = store.getSkinGrant(steam, preset.id);
  if (preset.exclusive && grant) {
    store.customizeSkinGrant({
      steamId: steam,
      presetId: preset.id,
      species: safeSpecies,
      name: safeName,
      description: safeDescription,
      skin: safeSkin,
    });
    return getPresetForPlayer(steam, preset.id);
  }

  const error = new Error('Skin preset not found or is not editable by this account');
  error.code = 'SKIN_PRESET_NOT_FOUND';
  throw error;
}

function deletePreset({ steamId, presetId }) {
  const steam = store.validateSteamId(steamId);
  const preset = store.getSkinPreset(presetId);
  if (!preset || !preset.active) {
    const error = new Error('Skin preset not found');
    error.code = 'SKIN_PRESET_NOT_FOUND';
    throw error;
  }

  if (preset.owner_steam_id === steam) {
    store.db.prepare(`UPDATE economy_skin_presets SET active = 0, published = 0, updated_at = datetime('now') WHERE id = ? AND owner_steam_id = ?`).run(preset.id, steam);
    return { id: preset.id, deleted: true, grantRemoved: false };
  }

  if (preset.exclusive && store.hasSkinGrant(steam, preset.id)) {
    const result = store.revokeSkinGrant({ steamId: steam, presetId: preset.id });
    return { id: preset.id, deleted: Boolean(result.revoked), grantRemoved: Boolean(result.revoked) };
  }

  const error = new Error('Skin preset not found or is not removable by this account');
  error.code = 'SKIN_PRESET_NOT_FOUND';
  throw error;
}

function purchasePreset({ steamId, presetId, idempotencyKey }) {
  if (!systemEnabled()) {
    const error = new Error('Skin preset system is disabled');
    error.code = 'SKIN_SYSTEM_DISABLED';
    throw error;
  }
  const steam = store.validateSteamId(steamId);
  const preset = store.getSkinPreset(presetId);
  if (!preset || !preset.active || !preset.published) {
    const error = new Error('Skin is not available in the store');
    error.code = 'SKIN_PRESET_NOT_FOUND';
    throw error;
  }

  if (preset.owner_steam_id === steam || preset.isPremium || store.hasSkinUnlock(steam, preset.id)) {
    return { duplicate: true, preset: { ...preset, owned: true }, wallet: store.getWallet(steam) };
  }

  const requestKey = validateIdempotencyKey(idempotencyKey);
  const unlockKey = `skin-unlock:${requestKey}`;
  const price = Math.max(0, Number(preset.price) || 0);

  store.db.exec('BEGIN IMMEDIATE');
  try {
    store.ensureWallet(steam);
    if (store.hasSkinUnlock(steam, preset.id)) {
      store.db.exec('COMMIT');
      return { duplicate: true, preset: { ...preset, owned: true }, wallet: store.getWallet(steam) };
    }

    const wallet = store.db.prepare('SELECT balance FROM economy_wallets WHERE steam_id = ?').get(steam);
    if (Number(wallet.balance) < price) {
      const error = new Error(`This skin costs ${price} Valley Coin`);
      error.code = 'INSUFFICIENT_FUNDS';
      throw error;
    }

    store.db.prepare(`
      INSERT INTO economy_skin_unlocks (steam_id, preset_id, purchase_price, idempotency_key)
      VALUES (?, ?, ?, ?)
    `).run(steam, preset.id, price, unlockKey);

    if (price > 0) {
      store.db.prepare('UPDATE economy_wallets SET balance = ?, updated_at = datetime(\'now\') WHERE steam_id = ?')
        .run(Number(wallet.balance) - price, steam);
      store.db.prepare(`
        INSERT INTO economy_wallet_ledger
          (id, steam_id, amount, kind, reason, idempotency_key, reference_type, reference_id, metadata_json)
        VALUES (?, ?, ?, 'skin_purchase', ?, ?, 'skin_preset', ?, ?)
      `).run(
        randomUUID(),
        steam,
        -price,
        `Unlocked skin: ${preset.name}`,
        `skin-purchase:${requestKey}`,
        preset.id,
        JSON.stringify({ species: preset.species, shareCode: preset.share_code || null })
      );
    }

    store.db.exec('COMMIT');
    return {
      duplicate: false,
      preset: { ...store.getSkinPreset(preset.id), owned: true },
      wallet: store.getWallet(steam),
    };
  } catch (error) {
    try { store.db.exec('ROLLBACK'); } catch {}
    if (/UNIQUE constraint failed: economy_skin_unlocks\.idempotency_key/i.test(String(error?.message || ''))) {
      return { duplicate: true, preset: { ...preset, owned: store.hasSkinUnlock(steam, preset.id) }, wallet: store.getWallet(steam) };
    }
    throw error;
  }
}

async function importSharedPreset({ steamId, shareCode, idempotencyKey }) {
  const steam = store.validateSteamId(steamId);
  const source = getSharedPreset(shareCode);
  const requestKey = validateIdempotencyKey(idempotencyKey);
  const createKey = `skin-import:${steam}:${requestKey}`;
  const existing = store.getSkinPresetByCreateKey(createKey);
  if (existing) return { duplicate: true, preset: existing };

  const preset = createPresetRecord({
    ownerSteamId: steam,
    species: source.species,
    name: `${source.name} Copy`.slice(0, 60),
    description: source.description || '',
    skin: source.skin,
    createKey,
  });
  return { duplicate: false, preset };
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
    if (String(preset.species).toLowerCase() !== 'universal' && targetSpecies.toLowerCase() !== String(preset.species).toLowerCase()) {
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
  liveWearEnabled,
  createCost,
  speciesFromClassPath,
  validateSpecies,
  validateName,
  sanitizeSkin,
  getPresetForPlayer,
  listAvailablePresets,
  listStore,
  getSharedPreset,
  createPresetFromStudio,
  createPresetFromStored,
  importSharedPreset,
  publishPreset,
  grantExclusivePreset,
  revokeExclusiveGrant,
  listExclusiveGrants,
  updatePreset,
  deletePreset,
  purchasePreset,
  applyPreset,
};
