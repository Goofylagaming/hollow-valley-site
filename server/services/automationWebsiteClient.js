function requireConfig() {
  const baseUrl = String(process.env.AUTOMATION_SERVICE_URL || '').trim().replace(/\/$/, '');
  const token = String(process.env.HOLLOW_VALLEY_API_TOKEN || '').trim();
  const timeoutMs = Math.max(1000, Math.min(30000, Number(process.env.AUTOMATION_SERVICE_TIMEOUT_MS || 8000)));
  if (!baseUrl) throw new Error('AUTOMATION_SERVICE_URL is not configured');
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error('AUTOMATION_SERVICE_URL must be an http(s) URL');
  if (!token) throw new Error('HOLLOW_VALLEY_API_TOKEN is not configured');
  return { baseUrl, token, timeoutMs };
}

function validateSteamId(value) {
  const steamId = String(value || '').trim();
  if (!/^\d{17}$/.test(steamId)) throw new Error('A valid 17-digit Steam ID is required');
  return steamId;
}

function validateRequestId(value) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) throw new Error('Invalid automation request ID');
  return id;
}

async function call(path, { method = 'GET', body } = {}) {
  if (typeof globalThis.fetch !== 'function') throw new Error('A fetch implementation is required');
  const { baseUrl, token, timeoutMs } = requireConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(`${baseUrl}/api/website${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    let payload = null;
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error(payload?.error || `Automation service request failed (${response.status})`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('Automation service request timed out');
      timeoutError.code = 'AUTOMATION_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function getActiveCharacter(steamId) {
  return call(`/dinostorage/active-character/${encodeURIComponent(validateSteamId(steamId))}`);
}

function listStoredDinos(steamId) {
  return call(`/dinostorage/${encodeURIComponent(validateSteamId(steamId))}`);
}

function requestDinoAction(action, { steamId, slot }) {
  if (!['store', 'redeem'].includes(action)) throw new Error('Unsupported DinoStorage action');
  const selectedSlot = String(slot || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(selectedSlot)) throw new Error('Invalid DinoStorage slot');
  return call(`/dinostorage/${action}`, {
    method: 'POST',
    body: { steamId: validateSteamId(steamId), slot: selectedSlot },
  });
}

function getRequestStatus(requestId, steamId) {
  return call(`/requests/${encodeURIComponent(validateRequestId(requestId))}?steamId=${encodeURIComponent(validateSteamId(steamId))}`);
}

function getBodyDropCooldown(steamId) {
  return call(`/bodydrop/cooldown/${encodeURIComponent(validateSteamId(steamId))}`);
}

function requestBodyDrop({ steamId, dropType }) {
  const type = String(dropType || '').trim();
  if (!/^[A-Za-z0-9_-]{2,32}$/.test(type)) throw new Error('Invalid body drop type');
  return call('/bodydrop', {
    method: 'POST',
    body: { steamId: validateSteamId(steamId), dropType: type },
  });
}

function listSkinStore(steamId = null, species = null) {
  const params = new URLSearchParams();
  if (steamId) params.set('steamId', validateSteamId(steamId));
  if (species) params.set('species', String(species));
  const query = params.toString();
  return call(`/skins/store${query ? `?${query}` : ''}`);
}

function listMySkins(steamId, species = null) {
  const query = species ? `?species=${encodeURIComponent(String(species))}` : '';
  return call(`/skins/${encodeURIComponent(validateSteamId(steamId))}${query}`);
}

function saveStudioSkin({ steamId, species, name, description, skin, idempotencyKey }) {
  return call('/skins/studio', {
    method: 'POST',
    body: {
      steamId: validateSteamId(steamId),
      species,
      name,
      description,
      skin,
      idempotencyKey,
    },
  });
}

function importSharedSkin({ steamId, shareCode, idempotencyKey }) {
  return call('/skins/import', {
    method: 'POST',
    body: { steamId: validateSteamId(steamId), shareCode, idempotencyKey },
  });
}

function getSharedSkin(shareCode) {
  const code = String(shareCode || '').trim();
  if (!/^[A-Za-z0-9-]{4,40}$/.test(code)) throw new Error('Invalid skin share code');
  return call(`/skins/share/${encodeURIComponent(code)}`);
}

function buySkin({ steamId, presetId, idempotencyKey }) {
  const id = String(presetId || '').trim();
  if (!/^[A-Za-z0-9-]{8,128}$/.test(id)) throw new Error('Invalid skin preset ID');
  return call(`/skins/${encodeURIComponent(id)}/buy`, {
    method: 'POST',
    body: { steamId: validateSteamId(steamId), idempotencyKey },
  });
}

function wearSkin({ steamId, presetId }) {
  const id = String(presetId || '').trim();
  if (!/^[A-Za-z0-9-]{8,128}$/.test(id)) throw new Error('Invalid skin preset ID');
  return call(`/skins/${encodeURIComponent(id)}/wear`, {
    method: 'POST',
    body: { steamId: validateSteamId(steamId) },
  });
}

function publishSkin({ presetId, price, description, published = true }) {
  const id = String(presetId || '').trim();
  if (!/^[A-Za-z0-9-]{8,128}$/.test(id)) throw new Error('Invalid skin preset ID');
  return call(`/skins/${encodeURIComponent(id)}/publish`, {
    method: 'POST',
    body: { price, description, published },
  });
}

function createSkinFromStored({ steamId, slot, name, idempotencyKey }) {
  return call('/skins/from-stored', {
    method: 'POST',
    body: { steamId: validateSteamId(steamId), slot, name, idempotencyKey },
  });
}

function applySkinToStored({ steamId, presetId, slot }) {
  const id = String(presetId || '').trim();
  if (!/^[A-Za-z0-9-]{8,128}$/.test(id)) throw new Error('Invalid skin preset ID');
  return call(`/skins/${encodeURIComponent(id)}/apply`, {
    method: 'POST',
    body: { steamId: validateSteamId(steamId), slot },
  });
}

function getWallet(steamId) {
  return call(`/wallet/${encodeURIComponent(validateSteamId(steamId))}`);
}

function getDailyLoginBonus(steamId) {
  return call(`/daily-login/${encodeURIComponent(validateSteamId(steamId))}`);
}

function claimDailyLoginBonus(steamId) {
  return call(`/daily-login/${encodeURIComponent(validateSteamId(steamId))}/claim`, { method: 'POST' });
}

function listMarketplaceCatalog() {
  return call('/marketplace/catalog');
}

function purchaseMarketplaceItem({ steamId, catalogId, idempotencyKey }) {
  const itemId = String(catalogId || '').trim();
  const key = String(idempotencyKey || '').trim();
  if (!/^[A-Za-z0-9:_-]{2,80}$/.test(itemId)) throw new Error('Invalid marketplace catalog ID');
  if (!/^[A-Za-z0-9:_-]{8,160}$/.test(key)) throw new Error('Invalid marketplace idempotency key');
  return call(`/marketplace/catalog/${encodeURIComponent(itemId)}/buy`, {
    method: 'POST',
    body: { steamId: validateSteamId(steamId), idempotencyKey: key },
  });
}

function adminCreditWallet({ steamId, amount }) {
  const credit = Number(amount);
  if (!Number.isSafeInteger(credit) || credit <= 0 || credit > 1000000) {
    throw new Error('Credit amount must be a whole number between 1 and 1,000,000');
  }
  return call('/admin-wallet/credit', {
    method: 'POST',
    body: { steamId: validateSteamId(steamId), amount: credit },
  });
}

function getDinoMarketplaceState() {
  return call('/marketplace/state');
}

function listDinoMarketplaceListings() {
  return call('/marketplace/listings');
}

function listMyDinoMarketplaceListings(steamId) {
  return call(`/marketplace/listings/mine/${encodeURIComponent(validateSteamId(steamId))}`);
}

function createDinoMarketplaceListing({ steamId, slot, price, idempotencyKey }) {
  const selectedSlot = String(slot || '').trim();
  const listingPrice = Number(price);
  const key = String(idempotencyKey || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(selectedSlot)) throw new Error('Invalid DinoStorage slot');
  if (!Number.isSafeInteger(listingPrice) || listingPrice <= 0 || listingPrice > 100000000) {
    throw new Error('Listing price must be a positive whole number');
  }
  if (!/^[A-Za-z0-9:_-]{8,160}$/.test(key)) throw new Error('Invalid marketplace idempotency key');
  return call('/marketplace/listings', {
    method: 'POST',
    body: {
      steamId: validateSteamId(steamId),
      slot: selectedSlot,
      price: listingPrice,
      idempotencyKey: key,
    },
  });
}

function cancelDinoMarketplaceListing({ steamId, listingId }) {
  const id = String(listingId || '').trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) throw new Error('Invalid marketplace listing ID');
  return call(`/marketplace/listings/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    body: { steamId: validateSteamId(steamId) },
  });
}

function buyDinoMarketplaceListing({ steamId, listingId, idempotencyKey }) {
  const id = String(listingId || '').trim();
  const key = String(idempotencyKey || '').trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) throw new Error('Invalid marketplace listing ID');
  if (!/^[A-Za-z0-9:_-]{8,160}$/.test(key)) throw new Error('Invalid marketplace idempotency key');
  return call(`/marketplace/listings/${encodeURIComponent(id)}/buy`, {
    method: 'POST',
    body: {
      steamId: validateSteamId(steamId),
      idempotencyKey: key,
    },
  });
}

module.exports = {
  getActiveCharacter,
  listStoredDinos,
  requestDinoAction,
  getRequestStatus,
  getBodyDropCooldown,
  requestBodyDrop,
  listSkinStore,
  listMySkins,
  saveStudioSkin,
  importSharedSkin,
  getSharedSkin,
  buySkin,
  wearSkin,
  publishSkin,
  createSkinFromStored,
  applySkinToStored,
  getWallet,
  getDailyLoginBonus,
  claimDailyLoginBonus,
  listMarketplaceCatalog,
  purchaseMarketplaceItem,
  adminCreditWallet,
  getDinoMarketplaceState,
  listDinoMarketplaceListings,
  listMyDinoMarketplaceListings,
  createDinoMarketplaceListing,
  cancelDinoMarketplaceListing,
  buyDinoMarketplaceListing,
};
