const { randomUUID } = require('node:crypto');
const { Readable } = require('node:stream');
const fileBridge = require('../adapters/fileBridge');
const SLOT_RE = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_JSON_BYTES = 128 * 1024;
const NUMERIC_FIELDS = [
  'growth',
  'health',
  'stamina',
  'hunger',
  'thirst',
  'oxygen',
  'blood',
  'lockedDamage',
  'food',
  'waterLevel',
  'rottenValue',
  'maxHealth',
  'maxBlood',
  'maxOxygen',
  'maxHunger',
  'maxFoodValue',
  'maxThirst',
  'maxStamina',
  'elderStacks',
  'capturedAt',
];
const NUTRIENT_NUMERIC_FIELDS = [
  'carbValue',
  'proteinValue',
  'lipidValue',
  'bonesValue',
  'cannibalValue',
  'magyValue',
  'rottenFleshValue',
  'mushroomsValue',
];

function parseRestoreInput(value) {
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > MAX_JSON_BYTES) throw new Error('Restore JSON is too large');
    try {
      value = JSON.parse(value);
    } catch (error) {
      throw new Error(`Restore JSON is invalid: ${error.message}`);
    }
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Restore JSON must be an object');
  }

  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_JSON_BYTES) throw new Error('Restore JSON is too large');
  return JSON.parse(serialized);
}

function validateFiniteField(object, key, { min = null, max = null } = {}) {
  if (!Object.hasOwn(object, key) || object[key] === null) return;
  const value = Number(object[key]);
  if (!Number.isFinite(value)) throw new Error(`${key} must be a finite number`);
  if (min !== null && value < min) throw new Error(`${key} must be at least ${min}`);
  if (max !== null && value > max) throw new Error(`${key} must be at most ${max}`);
  object[key] = value;
}

function validateRestoreState(state) {
  if (typeof state.classPath !== 'string' || !state.classPath.trim()) {
    throw new Error('classPath is required');
  }
  state.classPath = state.classPath.trim();
  if (state.classPath.length > 512 || !state.classPath.startsWith('/Game/')) {
    throw new Error('classPath must be a valid /Game/... class path');
  }

  if (Object.hasOwn(state, 'slot')) {
    const slot = String(state.slot || '').trim();
    if (!SLOT_RE.test(slot)) throw new Error('slot must contain only letters, numbers, underscores or hyphens');
    state.slot = slot;
  }

  for (const key of NUMERIC_FIELDS) {
    validateFiniteField(state, key, key === 'growth' ? { min: 0, max: 1 } : {});
  }

  if (Object.hasOwn(state, 'nutrients')) {
    if (!state.nutrients || typeof state.nutrients !== 'object' || Array.isArray(state.nutrients)) {
      throw new Error('nutrients must be an object');
    }
    for (const key of NUTRIENT_NUMERIC_FIELDS) validateFiniteField(state.nutrients, key);
    if (Object.hasOwn(state.nutrients, 'bMalnutrition') && typeof state.nutrients.bMalnutrition !== 'boolean') {
      throw new Error('nutrients.bMalnutrition must be true or false');
    }
  }

  if (Object.hasOwn(state, 'fullNutrients') && typeof state.fullNutrients !== 'boolean') {
    throw new Error('fullNutrients must be true or false');
  }

  return state;
}

function validateSteamId(steamId) {
  const value = String(steamId || '').trim();
  if (!/^\d{17}$/.test(value)) throw new Error('A valid 17-digit Steam ID is required');
  return value;
}

function validateSlot(slot) {
  const value = String(slot || '').trim();
  if (!SLOT_RE.test(value)) throw new Error('A valid DinoStorage slot is required');
  return value;
}

function isWriteEnabled() {
  return process.env.ADMIN_RESTORE_WRITE_ENABLED === 'true';
}

function getAdminRestoreState() {
  let ftpConfigured = true;
  let ftpError = null;
  try {
    fileBridge.getConfig();
    fileBridge.getUe4ssRemotePath();
  } catch (error) {
    ftpConfigured = false;
    ftpError = error.message;
  }
  return {
    builderReady: true,
    writeEnabled: isWriteEnabled(),
    ftpConfigured,
    ftpError,
    autoRedeem: false,
  };
}

function buildAdminRestoreJson({ restore, fullNutrients } = {}) {
  const state = validateRestoreState(parseRestoreInput(restore));

  if (fullNutrients !== undefined) {
    if (typeof fullNutrients !== 'boolean') throw new Error('fullNutrients override must be true or false');
    state.fullNutrients = fullNutrients;
  }

  return {
    state,
    json: JSON.stringify(state, null, 2),
    fullNutrients: state.fullNutrients === true,
    explicitNutrients: Boolean(state.nutrients),
  };
}

async function uploadAdminRestore({ steamId, slot, restore, fullNutrients } = {}, bridge = fileBridge) {
  if (!isWriteEnabled()) {
    const error = new Error('Admin restore file uploads are disabled. Set ADMIN_RESTORE_WRITE_ENABLED=true only for controlled operator use.');
    error.code = 'ADMIN_RESTORE_WRITE_DISABLED';
    throw error;
  }

  const steam = validateSteamId(steamId);
  const built = buildAdminRestoreJson({ restore, fullNutrients });
  const selectedSlot = validateSlot(slot || built.state.slot);
  built.state.slot = selectedSlot;
  const json = JSON.stringify(built.state, null, 2);
  const directory = `${bridge.getUe4ssRemotePath()}/Mods/DinoStorage/Saved/stored/${steam}`;
  const fileName = `${selectedSlot}.json`;
  const tempName = `${fileName}.upload-${randomUUID()}`;

  await bridge.withClient(async (client) => {
    await client.ensureDir(directory);
    try {
      const existing = await client.list();
      if (existing.some((entry) => entry.name === fileName)) {
        throw new Error(`DinoStorage slot ${selectedSlot} already exists for this Steam ID; refusing to overwrite it`);
      }

      await client.uploadFrom(Readable.from([Buffer.from(json, 'utf8')]), tempName);
      const stagedCheck = await client.list();
      if (stagedCheck.some((entry) => entry.name === fileName)) {
        await client.remove(tempName).catch(() => {});
        throw new Error(`DinoStorage slot ${selectedSlot} appeared while the upload was staged; refusing to overwrite it`);
      }
      await client.rename(tempName, fileName);
    } catch (error) {
      await client.remove(tempName).catch(() => {});
      throw error;
    } finally {
      await client.cd('/').catch(() => {});
    }
  });

  return {
    steamId: steam,
    slot: selectedSlot,
    fileName,
    remotePath: `${directory}/${fileName}`,
    bytes: Buffer.byteLength(json, 'utf8'),
    fullNutrients: built.state.fullNutrients === true,
    explicitNutrients: Boolean(built.state.nutrients),
    autoRedeem: false,
  };
}

module.exports = {
  MAX_JSON_BYTES,
  buildAdminRestoreJson,
  getAdminRestoreState,
  isWriteEnabled,
  parseRestoreInput,
  uploadAdminRestore,
  validateRestoreState,
  validateSteamId,
  validateSlot,
};
