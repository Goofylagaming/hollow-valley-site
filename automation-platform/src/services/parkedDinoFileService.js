const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const fileBridge = require('../adapters/fileBridge');
const commandBridge = require('./commandBridgeService');
const dinoStorage = require('./dinoStorageService');

const MAX_DINO_BYTES = 512 * 1024;
const SLOT_RE = /^[A-Za-z0-9_-]{1,80}$/;
const LISTING_RE = /^[0-9a-f-]{36}$/i;
const SYSTEM_STEAM_ID = '00000000000000000';
const COMMAND_TIMEOUT_MS = 7000;

function validateSteamId(value) {
  const steamId = String(value || '').trim();
  if (!/^\d{17}$/.test(steamId)) throw new Error('Invalid Steam ID');
  return steamId;
}

function validateSlot(value) {
  const slot = String(value || '').trim();
  if (!SLOT_RE.test(slot)) throw new Error('Invalid DinoStorage slot');
  return slot;
}

function validateListingId(value) {
  const id = String(value || '').trim();
  if (!LISTING_RE.test(id)) throw new Error('Invalid marketplace listing ID');
  return id;
}

function usingCommandBridgeStorage() {
  return commandBridge.getTransport() === 'http_pull';
}

function storedDirectory(steamId) {
  return `${fileBridge.getUe4ssRemotePath()}/Mods/DinoStorage/Saved/stored/${validateSteamId(steamId)}`;
}

function storedPath(steamId, slot) {
  return `${storedDirectory(steamId)}/${validateSlot(slot)}.json`;
}

function escrowDirectory() {
  return `${fileBridge.getUe4ssRemotePath()}/Mods/DinoStorage/Saved/marketplace-escrow`;
}

function escrowPath(listingId) {
  return `${escrowDirectory()}/${validateListingId(listingId)}.json`;
}

function missing(error) {
  return fileBridge.isMissingFtpError(error) || /no such file|not found|does not exist/i.test(String(error?.message || ''));
}

async function exists(client, remotePath) {
  try {
    await client.size(remotePath);
    return true;
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
}

async function readJson(client, remotePath) {
  if (!await exists(client, remotePath)) {
    const error = new Error(`DinoStorage file not found: ${remotePath}`);
    error.code = 'DINO_FILE_NOT_FOUND';
    throw error;
  }
  const size = await client.size(remotePath);
  if (size > MAX_DINO_BYTES) throw new Error('Stored dinosaur JSON exceeds 512 KiB');
  const sink = fileBridge.bufferWritable();
  await client.downloadTo(sink, remotePath);
  const buffer = sink.toBuffer();
  if (buffer.length > MAX_DINO_BYTES) throw new Error('Stored dinosaur JSON exceeds 512 KiB');
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch (error) {
    throw new Error(`Stored dinosaur JSON is invalid: ${error.message}`);
  }
}

async function writeJsonExclusive(client, remotePath, state) {
  const normalized = fileBridge.normalizeRemotePath(remotePath, 'DinoStorage file path');
  const slash = normalized.lastIndexOf('/');
  const directory = normalized.slice(0, slash);
  const fileName = normalized.slice(slash + 1);
  await client.ensureDir(directory);
  await client.cd('/').catch(() => {});
  if (await exists(client, normalized)) {
    const error = new Error(`DinoStorage target already exists: ${fileName}`);
    error.code = 'DINO_TARGET_EXISTS';
    throw error;
  }

  const body = Buffer.from(JSON.stringify(state, null, 2) + '\n', 'utf8');
  if (body.length > MAX_DINO_BYTES) throw new Error('Stored dinosaur JSON exceeds 512 KiB');
  const temp = `${normalized}.upload-${crypto.randomUUID()}`;
  let tempExists = false;
  try {
    tempExists = true;
    await client.uploadFrom(Readable.from([body]), temp);
    if (await exists(client, normalized)) {
      const error = new Error(`DinoStorage target appeared while staging: ${fileName}`);
      error.code = 'DINO_TARGET_EXISTS';
      throw error;
    }
    await client.rename(temp, normalized);
    tempExists = false;
  } finally {
    if (tempExists) await client.remove(temp).catch(() => {});
  }
}

async function replaceJson(client, remotePath, state) {
  const normalized = fileBridge.normalizeRemotePath(remotePath, 'DinoStorage file path');
  if (!await exists(client, normalized)) {
    const error = new Error('Parked dinosaur file no longer exists');
    error.code = 'DINO_FILE_NOT_FOUND';
    throw error;
  }

  const body = Buffer.from(JSON.stringify(state, null, 2) + '\n', 'utf8');
  if (body.length > MAX_DINO_BYTES) throw new Error('Stored dinosaur JSON exceeds 512 KiB');

  const temp = `${normalized}.edit-${crypto.randomUUID()}`;
  const backup = `${normalized}.backup-${crypto.randomUUID()}`;
  let tempExists = false;
  let backupExists = false;

  try {
    tempExists = true;
    await client.uploadFrom(Readable.from([body]), temp);

    await client.rename(normalized, backup);
    backupExists = true;

    try {
      await client.rename(temp, normalized);
      tempExists = false;
    } catch (error) {
      try {
        await client.rename(backup, normalized);
        backupExists = false;
      } catch (restoreError) {
        const rollbackError = new Error(
          `Parked dinosaur update failed and backup restore also failed: ${restoreError.message}`
        );
        rollbackError.code = 'DINO_EDIT_ROLLBACK_FAILED';
        rollbackError.cause = error;
        throw rollbackError;
      }
      throw error;
    }

    await client.remove(backup);
    backupExists = false;
  } finally {
    if (tempExists) await client.remove(temp).catch(() => {});
    if (backupExists) {
      if (!await exists(client, normalized).catch(() => false)) {
        await client.rename(backup, normalized).catch(() => {});
      } else {
        await client.remove(backup).catch(() => {});
      }
    }
  }
}

function bridgeError(message, fallbackCode = 'TRANSFER_UNCERTAIN') {
  const text = String(message || 'Marketplace game-server operation failed');
  const error = new Error(text);
  if (/target.*occupied|already contains|slot occupied/i.test(text)) {
    error.code = 'DINO_TARGET_EXISTS';
  } else if (/seller slot missing|slot missing|source missing|no parked dino|not found/i.test(text)) {
    error.code = 'DINO_FILE_NOT_FOUND';
  } else if (/escrow.*already exists/i.test(text)) {
    error.code = 'ESCROW_EXISTS';
  } else if (/escrow.*missing|outcome unknown|timed out/i.test(text)) {
    error.code = 'TRANSFER_UNCERTAIN';
  } else {
    error.code = fallbackCode;
  }
  return error;
}

async function runMarketplaceBridgeCommand({ steamId, operation, listingId, slot = null, timeoutMs = COMMAND_TIMEOUT_MS }) {
  const steam = validateSteamId(steamId);
  const listing = validateListingId(listingId);
  const tokens = ['marketplace', String(operation), listing];
  if (slot !== null && slot !== undefined) tokens.push(validateSlot(slot));

  const command = commandBridge.buildCommand('bd', steam, tokens);
  await commandBridge.queueCommand(command);

  const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || COMMAND_TIMEOUT_MS);
  do {
    const outcome = await commandBridge.readOutcome(command);
    if (outcome?.state === 'failed') throw bridgeError(outcome.message);
    if (outcome?.state === 'confirmed') return outcome.message;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, remaining)));
  } while (true);

  throw bridgeError(`Marketplace ${operation} timed out waiting for the game server`);
}

async function updateStoredDino(steamId, slot, mutator) {
  if (typeof mutator !== 'function') throw new Error('Parked dinosaur mutator is required');
  const remotePath = storedPath(steamId, slot);

  return fileBridge.withClient(async (client) => {
    const current = await readJson(client, remotePath);
    const draft = JSON.parse(JSON.stringify(current));
    const next = await mutator(draft, current);
    const finalState = next === undefined ? draft : next;
    if (!finalState || typeof finalState !== 'object' || Array.isArray(finalState)) {
      throw new Error('Parked dinosaur editor returned invalid state');
    }
    finalState.slot = validateSlot(slot);
    await replaceJson(client, remotePath, finalState);
    return finalState;
  });
}

async function createStoredDino(steamId, slot, state) {
  const steam = validateSteamId(steamId);
  const selectedSlot = validateSlot(slot);
  const next = JSON.parse(JSON.stringify(state || {}));
  next.slot = selectedSlot;
  return fileBridge.withClient(async (client) => {
    await writeJsonExclusive(client, storedPath(steam, selectedSlot), next);
    return next;
  });
}

async function readStoredDino(steamId, slot) {
  const steam = validateSteamId(steamId);
  const selectedSlot = validateSlot(slot);
  if (usingCommandBridgeStorage()) {
    return dinoStorage.getStoredDino(steam, selectedSlot);
  }
  return fileBridge.withClient((client) => readJson(client, storedPath(steam, selectedSlot)));
}

async function readEscrowDino(listingId) {
  if (usingCommandBridgeStorage()) {
    const error = new Error('Direct escrow JSON reads are unavailable over CommandBridge');
    error.code = 'ESCROW_READ_UNAVAILABLE';
    throw error;
  }
  return fileBridge.withClient((client) => readJson(client, escrowPath(listingId)));
}

async function storedExists(steamId, slot) {
  const steam = validateSteamId(steamId);
  const selectedSlot = validateSlot(slot);
  if (usingCommandBridgeStorage()) {
    try {
      await dinoStorage.getStoredDino(steam, selectedSlot);
      return true;
    } catch (error) {
      if (error?.code === 'DINO_FILE_NOT_FOUND' || /not found|slot not found/i.test(String(error?.message || ''))) return false;
      throw error;
    }
  }
  return fileBridge.withClient((client) => exists(client, storedPath(steam, selectedSlot)));
}

async function escrowExists(listingId) {
  const listing = validateListingId(listingId);
  if (usingCommandBridgeStorage()) {
    const message = await runMarketplaceBridgeCommand({
      steamId: SYSTEM_STEAM_ID,
      operation: 'escrow-exists',
      listingId: listing,
    });
    if (message === 'true') return true;
    if (message === 'false') return false;
    throw bridgeError(`Invalid marketplace escrow probe response: ${message}`);
  }
  return fileBridge.withClient((client) => exists(client, escrowPath(listing)));
}

async function moveStoredToEscrow({ listingId, steamId, slot }) {
  const listing = validateListingId(listingId);
  const steam = validateSteamId(steamId);
  const selectedSlot = validateSlot(slot);

  if (usingCommandBridgeStorage()) {
    await runMarketplaceBridgeCommand({
      steamId: steam,
      operation: 'escrow',
      listingId: listing,
      slot: selectedSlot,
    });
    return { source: `commandbridge:${steam}:${selectedSlot}`, target: `commandbridge:escrow:${listing}` };
  }

  const source = storedPath(steam, selectedSlot);
  const target = escrowPath(listing);
  return fileBridge.withClient(async (client) => {
    await client.ensureDir(escrowDirectory());
    await client.cd('/').catch(() => {});
    if (!await exists(client, source)) {
      const error = new Error('Parked dinosaur is no longer in the seller storage slot');
      error.code = 'DINO_FILE_NOT_FOUND';
      throw error;
    }
    if (await exists(client, target)) {
      const error = new Error('Marketplace escrow file already exists');
      error.code = 'ESCROW_EXISTS';
      throw error;
    }
    await client.rename(source, target);
    return { source, target };
  });
}

function transferMarker(state, listingId) {
  return state?.marketplaceTransfer?.listingId === listingId;
}

async function transferEscrowToStored({ listingId, buyerSteamId, buyerSlot }) {
  const listing = validateListingId(listingId);
  const buyer = validateSteamId(buyerSteamId);
  const selectedSlot = validateSlot(buyerSlot);

  if (usingCommandBridgeStorage()) {
    await runMarketplaceBridgeCommand({
      steamId: buyer,
      operation: 'transfer',
      listingId: listing,
      slot: selectedSlot,
    });
    return { transferred: true, resumed: false, target: `commandbridge:${buyer}:${selectedSlot}` };
  }

  const escrow = escrowPath(listing);
  const target = storedPath(buyer, selectedSlot);

  return fileBridge.withClient(async (client) => {
    const escrowPresent = await exists(client, escrow);
    const targetPresent = await exists(client, target);

    if (targetPresent) {
      const targetState = await readJson(client, target);
      if (!transferMarker(targetState, listing)) {
        const error = new Error('Buyer target slot already contains another dinosaur');
        error.code = 'DINO_TARGET_EXISTS';
        throw error;
      }
      if (escrowPresent) await client.remove(escrow);
      return { transferred: true, resumed: true, target };
    }

    if (!escrowPresent) {
      const error = new Error('Marketplace escrow file is missing and buyer target is absent');
      error.code = 'TRANSFER_UNCERTAIN';
      throw error;
    }

    const state = await readJson(client, escrow);
    state.slot = selectedSlot;
    delete state.marketplaceReturn;
    state.marketplaceTransfer = { listingId: listing };
    await writeJsonExclusive(client, target, state);

    try {
      await client.remove(escrow);
    } catch (error) {
      const uncertain = new Error(`Buyer copy was created but escrow cleanup failed: ${error.message}`);
      uncertain.code = 'TRANSFER_UNCERTAIN';
      throw uncertain;
    }

    return { transferred: true, resumed: false, target };
  });
}

async function restoreEscrowToSeller({ listingId, sellerSteamId, sellerSlot }) {
  const listing = validateListingId(listingId);
  const seller = validateSteamId(sellerSteamId);
  const selectedSlot = validateSlot(sellerSlot);

  if (usingCommandBridgeStorage()) {
    await runMarketplaceBridgeCommand({
      steamId: seller,
      operation: 'restore',
      listingId: listing,
      slot: selectedSlot,
    });
    return { restored: true, resumed: false, target: `commandbridge:${seller}:${selectedSlot}` };
  }

  const escrow = escrowPath(listing);
  const target = storedPath(seller, selectedSlot);

  return fileBridge.withClient(async (client) => {
    const escrowPresent = await exists(client, escrow);
    const targetPresent = await exists(client, target);

    if (targetPresent) {
      const targetState = await readJson(client, target);
      if (targetState?.marketplaceReturn?.listingId !== listing) {
        const error = new Error('Original seller storage slot is occupied');
        error.code = 'DINO_TARGET_EXISTS';
        throw error;
      }
      if (escrowPresent) await client.remove(escrow);
      return { restored: true, resumed: true, target };
    }

    if (!escrowPresent) {
      const error = new Error('Marketplace escrow file is missing and seller target is absent');
      error.code = 'TRANSFER_UNCERTAIN';
      throw error;
    }

    const state = await readJson(client, escrow);
    state.slot = selectedSlot;
    delete state.marketplaceTransfer;
    state.marketplaceReturn = { listingId: listing };
    await writeJsonExclusive(client, target, state);
    try {
      await client.remove(escrow);
    } catch (error) {
      const uncertain = new Error(`Seller copy was restored but escrow cleanup failed: ${error.message}`);
      uncertain.code = 'TRANSFER_UNCERTAIN';
      throw uncertain;
    }
    return { restored: true, resumed: false, target };
  });
}

module.exports = {
  MAX_DINO_BYTES,
  validateSteamId,
  validateSlot,
  validateListingId,
  storedDirectory,
  storedPath,
  escrowDirectory,
  escrowPath,
  createStoredDino,
  readStoredDino,
  updateStoredDino,
  readEscrowDino,
  storedExists,
  escrowExists,
  moveStoredToEscrow,
  transferEscrowToStored,
  restoreEscrowToSeller,
  _private: {
    usingCommandBridgeStorage,
    runMarketplaceBridgeCommand,
    bridgeError,
  },
};
