const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const fileBridge = require('../adapters/fileBridge');

const MAX_DINO_BYTES = 512 * 1024;
const SLOT_RE = /^[A-Za-z0-9_-]{1,80}$/;
const LISTING_RE = /^[0-9a-f-]{36}$/i;

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

async function readStoredDino(steamId, slot) {
  return fileBridge.withClient((client) => readJson(client, storedPath(steamId, slot)));
}

async function readEscrowDino(listingId) {
  return fileBridge.withClient((client) => readJson(client, escrowPath(listingId)));
}

async function storedExists(steamId, slot) {
  return fileBridge.withClient((client) => exists(client, storedPath(steamId, slot)));
}

async function escrowExists(listingId) {
  return fileBridge.withClient((client) => exists(client, escrowPath(listingId)));
}

async function moveStoredToEscrow({ listingId, steamId, slot }) {
  const source = storedPath(steamId, slot);
  const target = escrowPath(listingId);
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
  const escrow = escrowPath(listingId);
  const target = storedPath(buyerSteamId, buyerSlot);

  return fileBridge.withClient(async (client) => {
    const escrowPresent = await exists(client, escrow);
    const targetPresent = await exists(client, target);

    if (targetPresent) {
      const targetState = await readJson(client, target);
      if (!transferMarker(targetState, listingId)) {
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
    state.slot = validateSlot(buyerSlot);
    state.marketplaceTransfer = { listingId: validateListingId(listingId) };
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
  const escrow = escrowPath(listingId);
  const target = storedPath(sellerSteamId, sellerSlot);

  return fileBridge.withClient(async (client) => {
    const escrowPresent = await exists(client, escrow);
    const targetPresent = await exists(client, target);

    if (targetPresent) {
      const targetState = await readJson(client, target);
      if (targetState?.marketplaceReturn?.listingId !== listingId) {
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
    state.slot = validateSlot(sellerSlot);
    delete state.marketplaceTransfer;
    state.marketplaceReturn = { listingId: validateListingId(listingId) };
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
  readStoredDino,
  readEscrowDino,
  storedExists,
  escrowExists,
  moveStoredToEscrow,
  transferEscrowToStored,
  restoreEscrowToSeller,
};
