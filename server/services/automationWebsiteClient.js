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

async function callAdmin(path, { method = 'GET', body } = {}) {
  if (typeof globalThis.fetch !== 'function') throw new Error('A fetch implementation is required');
  const baseUrl = String(process.env.AUTOMATION_SERVICE_URL || '').trim().replace(/\/$/, '');
  const token = String(process.env.AUTOMATION_ADMIN_TOKEN || '').trim();
  const timeoutMs = Math.max(1000, Math.min(30000, Number(process.env.AUTOMATION_SERVICE_TIMEOUT_MS || 8000)));
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error('AUTOMATION_SERVICE_URL is not configured');
  if (!token) {
    const error = new Error('Automation admin API is not configured');
    error.status = 503;
    throw error;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(`${baseUrl}/api/admin${path}`, {
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
      const error = new Error(payload?.error || `Automation admin request failed (${response.status})`);
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

function getServerSnapshot() {
  return call('/server-snapshot');
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

function deleteStoredDino({ steamId, slot }) {
  const selectedSlot = String(slot || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(selectedSlot)) throw new Error('Invalid DinoStorage slot');
  return call('/dinostorage/delete', {
    method: 'POST',
    body: { steamId: validateSteamId(steamId), slot: selectedSlot },
  });
}

function scrapStoredDino({ steamId, slot }) {
  const selectedSlot = String(slot || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(selectedSlot)) throw new Error('Invalid DinoStorage slot');
  return call('/dinostorage/scrap', {
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

function getWallet(steamId) {
  return call(`/wallet/${encodeURIComponent(validateSteamId(steamId))}`);
}

function getQuests(steamId) {
  return call(`/quests/${encodeURIComponent(validateSteamId(steamId))}`);
}

function getProgression(steamId) {
  return call(`/progression/${encodeURIComponent(validateSteamId(steamId))}`);
}

function linkProgressionIdentity({ steamId, discordId }) {
  const discord = String(discordId || '').trim();
  if (!/^\d{15,22}$/.test(discord)) throw new Error('A valid Discord user ID is required');
  return call('/progression/link', {
    method: 'POST',
    body: { steamId: validateSteamId(steamId), discordId: discord },
  });
}

function getProgressionLeaderboard() {
  return call('/leaderboards/progression');
}

function getPrimeTracker(steamId) {
  return call(`/prime/${encodeURIComponent(validateSteamId(steamId))}`);
}

function getDailyLoginBonus(steamId) {
  return call(`/daily-login/${encodeURIComponent(validateSteamId(steamId))}`);
}

function claimDailyLoginBonus(steamId) {
  return call(`/daily-login/${encodeURIComponent(validateSteamId(steamId))}/claim`, { method: 'POST' });
}

function getDiscordScheduledEvents() {
  return call('/events');
}

function getEventRewards(steamId) {
  return call(`/events/rewards/${encodeURIComponent(validateSteamId(steamId))}`);
}

function getEventAttendance(steamId) {
  return call(`/events/attendance/${encodeURIComponent(validateSteamId(steamId))}`);
}

function setEventAttendance({ steamId, eventId, eventTitle, eventStart = null, eventEnd = null, attending = true }) {
  const id = String(eventId || '').trim();
  if (!/^[A-Za-z0-9:_-]{2,80}$/.test(id)) throw new Error('Invalid event ID');
  const title = String(eventTitle || '').trim();
  if (title.length < 2 || title.length > 120) throw new Error('Invalid event title');
  return call('/events/attendance', {
    method: 'POST',
    body: {
      steamId: validateSteamId(steamId),
      eventId: id,
      eventTitle: title,
      eventStart,
      eventEnd,
      attending: attending !== false,
    },
  });
}

function getMapActivity({ hours = 24 } = {}) {
  const safeHours = Math.max(1, Math.min(24 * 31, Number(hours) || 24));
  return call(`/map/activity?hours=${safeHours}`);
}

function getPlaytimeLeaderboard({ hours = 24 * 31 } = {}) {
  const safeHours = Math.max(1, Math.min(24 * 31, Number(hours) || 24 * 31));
  return call(`/leaderboards/playtime?hours=${safeHours}`);
}

function getCombatLeaderboard({ hours = 24 * 31 } = {}) {
  const safeHours = Math.max(1, Math.min(24 * 31, Number(hours) || 24 * 31));
  return call(`/leaderboards/combat?hours=${safeHours}`);
}

function listMarketplaceCatalog() {
  return call('/marketplace/catalog');
}

function updateMarketplaceCatalogItem({ catalogId, price, growthPercent, active, isPrime }) {
  const id = String(catalogId || '').trim();
  if (!/^[A-Za-z0-9:_-]{2,80}$/.test(id)) throw new Error('Invalid marketplace catalog ID');
  return call(`/marketplace/catalog/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: { price, growthPercent, active, isPrime },
  });
}

function listMarketplaceOrders(steamId) {
  return call(`/marketplace/orders/${encodeURIComponent(validateSteamId(steamId))}`);
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

function getParkedDinoMutations(steamId, slot) {
  const selectedSlot = String(slot || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(selectedSlot)) throw new Error('Invalid DinoStorage slot');
  return call(`/dinostorage/stored/${encodeURIComponent(validateSteamId(steamId))}/${encodeURIComponent(selectedSlot)}/mutations`);
}

function updateParkedDinoMutations({ steamId, slot, mutations }) {
  const selectedSlot = String(slot || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(selectedSlot)) throw new Error('Invalid DinoStorage slot');
  return call(`/dinostorage/stored/${encodeURIComponent(validateSteamId(steamId))}/${encodeURIComponent(selectedSlot)}/mutations`, {
    method: 'PUT',
    body: { mutations: mutations && typeof mutations === 'object' ? mutations : {} },
  });
}

function listSkinPresets(steamId, species = null) {
  const id = validateSteamId(steamId);
  const query = species ? `?species=${encodeURIComponent(String(species))}` : '';
  return call(`/skins/${encodeURIComponent(id)}${query}`);
}

function createSkinPresetFromStored({ steamId, slot, name, idempotencyKey }) {
  const selectedSlot = String(slot || '').trim();
  const presetName = String(name || '').trim();
  const key = String(idempotencyKey || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(selectedSlot)) throw new Error('Invalid DinoStorage slot');
  if (presetName.length < 2 || presetName.length > 60) throw new Error('Skin preset name must be 2-60 characters');
  if (!/^[A-Za-z0-9:_-]{8,160}$/.test(key)) throw new Error('Invalid idempotency key');
  return call('/skins/from-stored', {
    method: 'POST',
    body: { steamId: validateSteamId(steamId), slot: selectedSlot, name: presetName, idempotencyKey: key },
  });
}

function applySkinPreset({ steamId, slot, presetId }) {
  const selectedSlot = String(slot || '').trim();
  const id = String(presetId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(selectedSlot)) throw new Error('Invalid DinoStorage slot');
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) throw new Error('Invalid skin preset ID');
  return call(`/skins/${encodeURIComponent(id)}/apply`, {
    method: 'POST',
    body: { steamId: validateSteamId(steamId), slot: selectedSlot },
  });
}

function listSkinStore(steamId = null, species = null) {
  const params = new URLSearchParams();
  if (steamId) params.set('steamId', validateSteamId(steamId));
  if (species) params.set('species', String(species));
  const query = params.toString();
  return call(`/skins/store${query ? `?${query}` : ''}`);
}

function saveStudioSkin({ steamId, species, name, description, skin, idempotencyKey }) {
  const key = String(idempotencyKey || '').trim();
  if (!/^[A-Za-z0-9:_-]{8,160}$/.test(key)) throw new Error('Invalid idempotency key');
  return call('/skins/studio', {
    method: 'POST',
    body: {
      steamId: validateSteamId(steamId),
      species,
      name,
      description,
      skin,
      idempotencyKey: key,
    },
  });
}

function importSharedSkin({ steamId, shareCode, idempotencyKey }) {
  const code = String(shareCode || '').trim();
  const key = String(idempotencyKey || '').trim();
  if (!/^[A-Za-z0-9-]{4,40}$/.test(code)) throw new Error('Invalid skin share code');
  if (!/^[A-Za-z0-9:_-]{8,160}$/.test(key)) throw new Error('Invalid idempotency key');
  return call('/skins/import', {
    method: 'POST',
    body: { steamId: validateSteamId(steamId), shareCode: code, idempotencyKey: key },
  });
}

function getSharedSkin(shareCode) {
  const code = String(shareCode || '').trim();
  if (!/^[A-Za-z0-9-]{4,40}$/.test(code)) throw new Error('Invalid skin share code');
  return call(`/skins/share/${encodeURIComponent(code)}`);
}

function buySkin({ steamId, presetId, idempotencyKey }) {
  const id = String(presetId || '').trim();
  const key = String(idempotencyKey || '').trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) throw new Error('Invalid skin preset ID');
  if (!/^[A-Za-z0-9:_-]{8,160}$/.test(key)) throw new Error('Invalid idempotency key');
  return call(`/skins/${encodeURIComponent(id)}/buy`, {
    method: 'POST',
    body: { steamId: validateSteamId(steamId), idempotencyKey: key },
  });
}

function updateSkin({ steamId, presetId, species, name, description, skin }) {
  const id = String(presetId || '').trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) throw new Error('Invalid skin preset ID');
  return call(`/skins/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: { steamId: validateSteamId(steamId), species, name, description, skin },
  });
}

function deleteSkin({ steamId, presetId }) {
  const id = String(presetId || '').trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) throw new Error('Invalid skin preset ID');
  return call(`/skins/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    body: { steamId: validateSteamId(steamId) },
  });
}

function wearSkin({ steamId, presetId }) {
  const id = String(presetId || '').trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) throw new Error('Invalid skin preset ID');
  return call(`/skins/${encodeURIComponent(id)}/wear`, {
    method: 'POST',
    body: { steamId: validateSteamId(steamId) },
  });
}

function grantExclusiveSkin({ presetId, steamId, grantedBySteamId = null, note = '' }) {
  const id = String(presetId || '').trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) throw new Error('Invalid skin preset ID');
  return call(`/skins/${encodeURIComponent(id)}/grant`, {
    method: 'POST',
    body: {
      steamId: validateSteamId(steamId),
      grantedBySteamId: grantedBySteamId ? validateSteamId(grantedBySteamId) : null,
      note: String(note || '').trim().slice(0, 240),
    },
  });
}

function revokeExclusiveSkin({ presetId, steamId }) {
  const id = String(presetId || '').trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) throw new Error('Invalid skin preset ID');
  return call(`/skins/${encodeURIComponent(id)}/revoke`, {
    method: 'POST',
    body: { steamId: validateSteamId(steamId) },
  });
}

function listExclusiveSkinGrants(presetId) {
  const id = String(presetId || '').trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) throw new Error('Invalid skin preset ID');
  return call(`/skins/${encodeURIComponent(id)}/grants`);
}

function publishSkin({ presetId, price, description, published = true }) {
  const id = String(presetId || '').trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) throw new Error('Invalid skin preset ID');
  return call(`/skins/${encodeURIComponent(id)}/publish`, {
    method: 'POST',
    body: { price, description, published },
  });
}

function getAdminEventRewards({ limit = 100 } = {}) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  return callAdmin(`/events/rewards?limit=${safeLimit}`);
}

function awardAdminEventReward({ steamId, eventId, eventTitle, baseAmount }) {
  return callAdmin('/events/reward', {
    method: 'POST',
    body: {
      steamId: validateSteamId(steamId),
      eventId,
      eventTitle,
      baseAmount,
    },
  });
}

function getAdminEventAttendance({ eventId = null, limit = 500 } = {}) {
  const params = new URLSearchParams();
  if (eventId) params.set('eventId', String(eventId));
  params.set('limit', String(Math.max(1, Math.min(1000, Number(limit) || 500))));
  return callAdmin(`/events/attendance?${params.toString()}`);
}

function addAdminEventAttendee({ steamId, eventId, eventTitle, eventStart = null, eventEnd = null, addedBySteamId = null }) {
  return callAdmin('/events/attendance/add', {
    method: 'POST',
    body: {
      steamId: validateSteamId(steamId),
      eventId,
      eventTitle,
      eventStart,
      eventEnd,
      addedBySteamId: addedBySteamId ? validateSteamId(addedBySteamId) : null,
    },
  });
}

function removeAdminEventAttendee({ steamId, eventId, removedBySteamId = null }) {
  return callAdmin('/events/attendance/remove', {
    method: 'POST',
    body: {
      steamId: validateSteamId(steamId),
      eventId,
      removedBySteamId: removedBySteamId ? validateSteamId(removedBySteamId) : null,
    },
  });
}

function confirmAdminEventAttendance({ steamId, eventId, confirmedBySteamId = null }) {
  return callAdmin('/events/attendance/confirm', {
    method: 'POST',
    body: {
      steamId: validateSteamId(steamId),
      eventId,
      confirmedBySteamId: confirmedBySteamId ? validateSteamId(confirmedBySteamId) : null,
    },
  });
}

function confirmAllAdminEventAttendance({ eventId, confirmedBySteamId = null }) {
  return callAdmin('/events/attendance/confirm-all', {
    method: 'POST',
    body: {
      eventId,
      confirmedBySteamId: confirmedBySteamId ? validateSteamId(confirmedBySteamId) : null,
    },
  });
}

function awardAdminEventBonus({
  steamId,
  eventId,
  eventTitle,
  amount,
  label,
  bonusId,
  applySupporterMultiplier = false,
  awardedBySteamId = null,
}) {
  const payout = Number(amount);
  if (!Number.isSafeInteger(payout) || payout <= 0 || payout > 1000000) {
    throw new Error('Bonus payout must be a whole number between 1 and 1,000,000');
  }
  return callAdmin('/events/bonus', {
    method: 'POST',
    body: {
      steamId: validateSteamId(steamId),
      eventId,
      eventTitle,
      amount: payout,
      label,
      bonusId,
      applySupporterMultiplier: applySupporterMultiplier === true,
      awardedBySteamId: awardedBySteamId ? validateSteamId(awardedBySteamId) : null,
    },
  });
}

function getAdminOperationsStatus({ force = false } = {}) {
  return callAdmin(`/status${force ? '?force=1' : ''}`);
}

function getAdminAudit({ limit = 50, category = null } = {}) {
  const params = new URLSearchParams();
  params.set('limit', String(Math.max(1, Math.min(200, Number(limit) || 50))));
  if (category) params.set('category', String(category));
  return callAdmin(`/audit?${params.toString()}`);
}

function getAdminRequests({ limit = 50, kind = null } = {}) {
  const params = new URLSearchParams();
  params.set('limit', String(Math.max(1, Math.min(200, Number(limit) || 50))));
  if (kind) params.set('kind', String(kind));
  return callAdmin(`/requests?${params.toString()}`);
}

function getAdminPresence({ limit = 50, activeOnly = false } = {}) {
  const params = new URLSearchParams();
  params.set('limit', String(Math.max(1, Math.min(200, Number(limit) || 50))));
  if (activeOnly) params.set('active', '1');
  return callAdmin(`/presence?${params.toString()}`);
}

function getAdminMigrationReadiness() {
  return callAdmin('/migration-readiness');
}

function getAdminBackupState() {
  return callAdmin('/backups');
}

function getAdminGlobalBodyDropState() {
  return callAdmin('/bodydrop/global');
}

function setAdminGlobalBodyDropEnabled(enabled) {
  return callAdmin('/bodydrop/global/toggle', {
    method: 'POST',
    body: { enabled: enabled === true },
  });
}

function activateAdminGlobalBodyDrop() {
  return callAdmin('/bodydrop/global/activate', {
    method: 'POST',
  });
}

function wipeAdminCorpses(confirm) {
  if (String(confirm || '') !== 'WIPE CORPSES') {
    throw new Error('Corpse wipe requires the exact confirmation WIPE CORPSES');
  }
  return callAdmin('/rcon/wipe-corpses', {
    method: 'POST',
    body: { confirm: 'WIPE CORPSES' },
  });
}

function createAdminBackup() {
  return callAdmin('/backups', { method: 'POST' });
}

function getAdminServerHealth({ hours = 24 } = {}) {
  const safeHours = Math.max(1, Math.min(24 * 31, Number(hours) || 24));
  return callAdmin(`/server-health/analytics?hours=${safeHours}`);
}

function getAdminDiscordState() {
  return callAdmin('/discord');
}

function syncAdminDiscordStatus() {
  return callAdmin('/discord/sync-status', { method: 'POST' });
}

function sendAdminDiscordAnnouncement(message) {
  return callAdmin('/discord/announce', {
    method: 'POST',
    body: { message: String(message || '') },
  });
}

function getAdminJobs() {
  return callAdmin('/jobs');
}

function scheduleAdminDiscordAnnouncement({ message, runAt, recurrence = 'none' }) {
  return callAdmin('/jobs/discord-announcement', {
    method: 'POST',
    body: {
      message: String(message || ''),
      runAt,
      recurrence,
    },
  });
}

function cancelAdminJob(jobId) {
  const id = String(jobId || '').trim();
  if (!/^[A-Za-z0-9:_-]{8,128}$/.test(id)) throw new Error('Invalid scheduled job ID');
  return callAdmin(`/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
}

function getAdminRestoreState() {
  return callAdmin('/dinostorage/admin-restore');
}

function buildAdminRestoreJson({ restore, fullNutrients = false }) {
  return callAdmin('/dinostorage/admin-restore-json', {
    method: 'POST',
    body: { restore, fullNutrients: Boolean(fullNutrients) },
  });
}

function uploadAdminRestore({ steamId, slot, restore, fullNutrients = false }) {
  return callAdmin('/dinostorage/admin-restore/upload', {
    method: 'POST',
    body: { steamId, slot, restore, fullNutrients: Boolean(fullNutrients) },
  });
}

module.exports = {
  getServerSnapshot,
  getActiveCharacter,
  listStoredDinos,
  requestDinoAction,
  deleteStoredDino,
  scrapStoredDino,
  getRequestStatus,
  getBodyDropCooldown,
  requestBodyDrop,
  getWallet,
  getQuests,
  getProgression,
  linkProgressionIdentity,
  getProgressionLeaderboard,
  getPrimeTracker,
  getDailyLoginBonus,
  claimDailyLoginBonus,
  getDiscordScheduledEvents,
  getEventRewards,
  getEventAttendance,
  setEventAttendance,
  getMapActivity,
  getPlaytimeLeaderboard,
  getCombatLeaderboard,
  listMarketplaceCatalog,
  updateMarketplaceCatalogItem,
  listMarketplaceOrders,
  purchaseMarketplaceItem,
  adminCreditWallet,
  getDinoMarketplaceState,
  listDinoMarketplaceListings,
  listMyDinoMarketplaceListings,
  createDinoMarketplaceListing,
  cancelDinoMarketplaceListing,
  buyDinoMarketplaceListing,
  getParkedDinoMutations,
  updateParkedDinoMutations,
  listSkinPresets,
  createSkinPresetFromStored,
  applySkinPreset,
  listSkinStore,
  saveStudioSkin,
  importSharedSkin,
  getSharedSkin,
  buySkin,
  updateSkin,
  deleteSkin,
  wearSkin,
  grantExclusiveSkin,
  revokeExclusiveSkin,
  listExclusiveSkinGrants,
  publishSkin,
  getAdminEventRewards,
  awardAdminEventReward,
  getAdminEventAttendance,
  addAdminEventAttendee,
  removeAdminEventAttendee,
  confirmAdminEventAttendance,
  confirmAllAdminEventAttendance,
  awardAdminEventBonus,
  getAdminOperationsStatus,
  getAdminAudit,
  getAdminRequests,
  getAdminPresence,
  getAdminMigrationReadiness,
  getAdminBackupState,
  getAdminGlobalBodyDropState,
  setAdminGlobalBodyDropEnabled,
  activateAdminGlobalBodyDrop,
  wipeAdminCorpses,
  createAdminBackup,
  getAdminServerHealth,
  getAdminDiscordState,
  syncAdminDiscordStatus,
  sendAdminDiscordAnnouncement,
  getAdminJobs,
  scheduleAdminDiscordAnnouncement,
  cancelAdminJob,
  getAdminRestoreState,
  buildAdminRestoreJson,
  uploadAdminRestore,
};
