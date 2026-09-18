const express = require('express');
const { requireWebsiteToken } = require('../middleware/websiteAuth');
const bodyDrop = require('../services/bodyDropService');
const dinoStorage = require('../services/dinoStorageService');
const audit = require('../services/auditService');
const store = require('../services/automationStore');
const statusService = require('../services/statusService');
const economy = require('../services/economyStore');
const marketplace = require('../services/marketplaceService');
const playtimeRewards = require('../services/playtimeRewardsService');
const questBoosts = require('../services/questBoostService');
const dinoMarketplace = require('../services/dinoMarketplaceService');
const parkedDinoMutations = require('../services/parkedDinoMutationService');
const skinPresets = require('../services/skinPresetService');

const router = express.Router();
router.use(requireWebsiteToken);

function validateSteamId(value) {
  const steamId = String(value || '').trim();
  if (!/^\d{17}$/.test(steamId)) throw new Error('A valid 17-digit Steam ID is required');
  return steamId;
}

router.get('/wallet/:steamId', (req, res) => {
  try {
    const steamId = validateSteamId(req.params.steamId);
    const wallet = economy.getWallet(steamId);
    const progress = economy.getPlaytimeProgress(steamId);
    const rewardState = playtimeRewards.state();
    const questState = questBoosts.getQuestStatus(steamId);
    const intervalMs = rewardState.intervalSeconds * 1000;
    const accruedMs = Math.max(0, Number(progress?.accrued_ms || 0));
    const activeBoostPercent = Number(questState.activeBoostPercent || 0);
    const bonusCoins = Math.floor((rewardState.coinsPer5Minutes * activeBoostPercent) / 100);

    res.json({
      ...wallet,
      earning: {
        enabled: rewardState.enabled,
        configured: rewardState.configured,
        coinsPer5Minutes: rewardState.coinsPer5Minutes,
        activeBoostPercent,
        boostedCoinsPer5Minutes: rewardState.coinsPer5Minutes + bonusCoins,
        intervalSeconds: rewardState.intervalSeconds,
        accruedSeconds: Math.floor(accruedMs / 1000),
        nextRewardInSeconds: rewardState.configured
          ? Math.max(0, Math.ceil((intervalMs - accruedMs) / 1000))
          : null,
        rewardedIntervals: Number(progress?.rewarded_intervals || 0),
      },
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to read Valley Coin wallet.' });
  }
});

router.get('/quests/:steamId', (req, res) => {
  try {
    const steamId = validateSteamId(req.params.steamId);
    res.json(questBoosts.getQuestStatus(steamId));
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to read playtime quests.' });
  }
});

router.get('/marketplace/catalog', (_req, res) => {
  res.json({ catalog: economy.listCatalog({ activeOnly: true }) });
});

router.get('/marketplace/orders/:steamId', (req, res) => {
  try {
    const steamId = validateSteamId(req.params.steamId);
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 25));
    res.json({ orders: economy.listOrders({ steamId, limit }) });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to read marketplace orders.' });
  }
});

router.post('/marketplace/catalog/:catalogId/buy', async (req, res) => {
  const catalogId = String(req.params.catalogId || '').trim();
  const idempotencyKey = String(req.body?.idempotencyKey || '').trim();
  try {
    const steamId = validateSteamId(req.body?.steamId);
    const result = await audit.run('website', 'marketplace_purchase', {
      catalogId,
      steamId,
    }, async () => marketplace.purchaseCatalogItem({
      steamId,
      catalogId,
      idempotencyKey,
    }), (value) => ({
      orderId: value.order?.id || null,
      duplicate: Boolean(value.duplicate),
      balance: value.wallet?.balance ?? null,
    }));
    res.status(result.duplicate ? 200 : 201).json({ ok: true, ...result });
  } catch (error) {
    if (error.code === 'INSUFFICIENT_FUNDS') {
      return res.status(402).json({ error: error.message });
    }
    if (error.code === 'CATALOG_ITEM_UNAVAILABLE') {
      return res.status(404).json({ error: error.message });
    }
    res.status(400).json({ error: error.message || 'Marketplace purchase failed.' });
  }
});

router.get('/marketplace/listings', (_req, res) => {
  res.json({ listings: dinoMarketplace.listPublicListings({ limit: 200 }) });
});

router.get('/marketplace/listings/mine/:steamId', (req, res) => {
  try {
    const steamId = validateSteamId(req.params.steamId);
    res.json({ listings: dinoMarketplace.listSellerListings(steamId, { limit: 200 }) });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to read marketplace listings.' });
  }
});

router.post('/marketplace/listings', async (req, res) => {
  try {
    const steamId = validateSteamId(req.body?.steamId);
    const result = await audit.run('website', 'marketplace_list_dino', {
      steamId,
      slot: req.body?.slot || null,
      price: Number(req.body?.price) || null,
    }, async () => dinoMarketplace.createDinoListing({
      sellerSteamId: steamId,
      slot: req.body?.slot,
      price: req.body?.price,
      idempotencyKey: req.body?.idempotencyKey,
    }), (value) => ({
      listingId: value.listing?.id || null,
      duplicate: Boolean(value.duplicate),
      status: value.listing?.status || null,
    }));
    res.status(result.duplicate ? 200 : 201).json({ ok: true, ...result });
  } catch (error) {
    const status = error.code === 'DINO_ALREADY_LISTED' ? 409 :
      error.code === 'DINO_FILE_NOT_FOUND' ? 404 : 400;
    res.status(status).json({ error: error.message || 'Unable to list parked dinosaur.' });
  }
});

router.post('/marketplace/listings/:listingId/buy', async (req, res) => {
  try {
    const steamId = validateSteamId(req.body?.steamId);
    const result = await audit.run('website', 'marketplace_buy_listing', {
      listingId: req.params.listingId,
      buyerSteamId: steamId,
    }, async () => dinoMarketplace.buyDinoListing({
      buyerSteamId: steamId,
      listingId: req.params.listingId,
      idempotencyKey: req.body?.idempotencyKey,
    }), (value) => ({
      listingId: value.listing?.id || null,
      status: value.listing?.status || null,
      duplicate: Boolean(value.duplicate),
      balance: value.wallet?.balance ?? null,
    }));
    res.status(result.duplicate ? 200 : 201).json({ ok: true, ...result });
  } catch (error) {
    const status = error.code === 'INSUFFICIENT_FUNDS' ? 402 :
      error.code === 'LISTING_NOT_FOUND' ? 404 :
      error.code === 'TRANSFER_UNCERTAIN' ? 409 : 400;
    res.status(status).json({
      error: error.message || 'Marketplace listing purchase failed.',
      code: error.code || null,
    });
  }
});

router.post('/marketplace/listings/:listingId/cancel', async (req, res) => {
  try {
    const steamId = validateSteamId(req.body?.steamId);
    const result = await audit.run('website', 'marketplace_cancel_listing', {
      listingId: req.params.listingId,
      sellerSteamId: steamId,
    }, async () => dinoMarketplace.cancelDinoListing({
      sellerSteamId: steamId,
      listingId: req.params.listingId,
    }), (value) => ({
      listingId: value.listing?.id || null,
      status: value.listing?.status || null,
      duplicate: Boolean(value.duplicate),
    }));
    res.json({ ok: true, ...result });
  } catch (error) {
    const status = error.code === 'LISTING_NOT_FOUND' ? 404 :
      error.code === 'TRANSFER_UNCERTAIN' ? 409 : 400;
    res.status(status).json({
      error: error.message || 'Marketplace listing cancellation failed.',
      code: error.code || null,
    });
  }
});

router.get('/dinostorage/stored/:steamId/:slot/mutations', async (req, res) => {
  try {
    const steamId = validateSteamId(req.params.steamId);
    res.json(await parkedDinoMutations.getMutationEditor(steamId, req.params.slot));
  } catch (error) {
    const status = error.code === 'DINO_FILE_NOT_FOUND' ? 404 : 400;
    res.status(status).json({ error: error.message || 'Unable to read parked dino mutations.' });
  }
});

router.put('/dinostorage/stored/:steamId/:slot/mutations', async (req, res) => {
  try {
    const steamId = validateSteamId(req.params.steamId);
    const result = await audit.run('website', 'parked_dino_mutations', {
      steamId,
      slot: req.params.slot,
    }, async () => parkedDinoMutations.updateMutations({
      steamId,
      slot: req.params.slot,
      mutations: req.body?.mutations || {},
    }), (value) => ({
      slot: value.slot,
      mutationCount: Object.values(value.mutations || {}).filter(Boolean).length,
    }));
    res.json({ ok: true, ...result });
  } catch (error) {
    const status = error.code === 'PARKED_DINO_EDIT_DISABLED' ? 503 :
      error.code === 'DINO_FILE_NOT_FOUND' ? 404 :
      error.code === 'DUPLICATE_MUTATION' || error.code === 'MUTATION_NOT_ALLOWED' ? 400 : 400;
    res.status(status).json({ error: error.message || 'Unable to update parked dino mutations.', code: error.code || null });
  }
});

router.get('/skins/:steamId', (req, res) => {
  try {
    const steamId = validateSteamId(req.params.steamId);
    const species = req.query.species ? String(req.query.species) : null;
    res.json({
      systemEnabled: skinPresets.systemEnabled(),
      applyEnabled: skinPresets.applyEnabled(),
      createCost: skinPresets.createCost(),
      presets: skinPresets.listAvailablePresets(steamId, { species }),
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to read skin presets.' });
  }
});

router.post('/skins/from-stored', async (req, res) => {
  try {
    const steamId = validateSteamId(req.body?.steamId);
    const result = await audit.run('website', 'skin_preset_create', {
      steamId,
      slot: req.body?.slot || null,
      nameLength: String(req.body?.name || '').trim().length,
    }, async () => skinPresets.createPresetFromStored({
      steamId,
      slot: req.body?.slot,
      name: req.body?.name,
      idempotencyKey: req.body?.idempotencyKey,
    }), (value) => ({
      presetId: value.preset?.id || null,
      species: value.preset?.species || null,
      duplicate: Boolean(value.duplicate),
      balance: value.wallet?.balance ?? null,
    }));
    res.status(result.duplicate ? 200 : 201).json({ ok: true, ...result });
  } catch (error) {
    const status = error.code === 'SKIN_SYSTEM_DISABLED' ? 503 :
      error.code === 'INSUFFICIENT_FUNDS' ? 402 :
      error.code === 'DINO_FILE_NOT_FOUND' ? 404 : 400;
    res.status(status).json({ error: error.message || 'Unable to create skin preset.', code: error.code || null });
  }
});

router.post('/skins/:presetId/apply', async (req, res) => {
  try {
    const steamId = validateSteamId(req.body?.steamId);
    const result = await audit.run('website', 'skin_preset_apply', {
      steamId,
      slot: req.body?.slot || null,
      presetId: req.params.presetId,
    }, async () => skinPresets.applyPreset({
      steamId,
      slot: req.body?.slot,
      presetId: req.params.presetId,
    }), (value) => ({
      presetId: value.preset?.id || null,
      slot: value.slot,
      species: value.species,
    }));
    res.json({ ok: true, ...result });
  } catch (error) {
    const status = error.code === 'PARKED_DINO_EDIT_DISABLED' ? 503 :
      error.code === 'SKIN_PRESET_NOT_FOUND' || error.code === 'DINO_FILE_NOT_FOUND' ? 404 :
      error.code === 'SKIN_SPECIES_MISMATCH' ? 409 : 400;
    res.status(status).json({ error: error.message || 'Unable to apply skin preset.', code: error.code || null });
  }
});

router.get('/bodydrop/cooldown/:steamId', async (req, res) => {
  try {
    const steamId = validateSteamId(req.params.steamId);
    res.json(await bodyDrop.getBodyDropState(steamId));
  } catch (error) {
    const unavailable = /server|rcon|connection|timeout/i.test(error.message || '');
    res.status(unavailable ? 503 : 400).json({ error: error.message });
  }
});

router.post('/bodydrop', async (req, res) => {
  const dropType = String(req.body?.dropType || '').trim();
  try {
    const request = await audit.run('website', 'bodydrop_request', { dropType },
      () => bodyDrop.requestBodyDrop({ steamId: req.body?.steamId, dropType }),
      (value) => ({ requestId: value.id, status: value.status }));
    res.status(202).json({ ok: true, request });
  } catch (error) {
    if (error.code === 'BODYDROP_COOLDOWN') {
      return res.status(429).json({ error: error.message, cooldown: error.cooldown });
    }
    if (error.code === 'BODYDROP_INELIGIBLE') {
      return res.status(403).json({ error: error.message, eligibility: error.eligibility });
    }
    const unavailable = /server|rcon|connection|timeout/i.test(error.message || '');
    res.status(unavailable ? 503 : 400).json({ error: error.message || 'BodyDrop request failed.' });
  }
});

router.get('/dinostorage/active-character/:steamId', async (req, res) => {
  try {
    const steamId = validateSteamId(req.params.steamId);
    const snapshot = await statusService.getServerSnapshot();
    if (!snapshot.online) return res.json({ active: false, reason: 'server_offline' });

    const character = (snapshot.characters || []).find((entry) => entry.steamId === steamId);
    if (!character) return res.json({ active: false, reason: 'not_in_game' });

    res.json({
      active: true,
      character: {
        name: character.name || null,
        species: character.species || null,
        gender: character.gender || null,
        growth: Number.isFinite(character.growth) ? character.growth : null,
        health: Number.isFinite(character.health) ? character.health : null,
        stamina: Number.isFinite(character.stamina) ? character.stamina : null,
        hunger: Number.isFinite(character.hunger) ? character.hunger : null,
        thirst: Number.isFinite(character.thirst) ? character.thirst : null,
        isPrime: character.isPrime === true,
        mutations: Array.isArray(character.mutations) ? character.mutations : [],
        location: character.location || null,
      },
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to read active character.' });
  }
});

router.get('/dinostorage/:steamId', async (req, res) => {
  try {
    const steamId = validateSteamId(req.params.steamId);
    const dinos = await dinoStorage.listStoredDinos(steamId);
    res.json({ steamId, dinos });
  } catch (error) {
    res.status(502).json({ error: error.message || 'Unable to list DinoStorage slots.' });
  }
});

async function dinoAction(req, res, action) {
  const slot = String(req.body?.slot || 'default').trim();
  try {
    const request = await audit.run('website', `dinostorage_${action}`, { slot },
      () => dinoStorage.requestDinoStorageAction({
        action,
        steamId: req.body?.steamId,
        slot,
      }),
      (value) => ({ requestId: value.id, status: value.status }));
    res.status(202).json({ ok: true, completionConfirmed: false, request });
  } catch (error) {
    if (error.code === 'DINOSTORAGE_PENDING') {
      return res.status(409).json({ error: error.message, request: error.request });
    }
    res.status(502).json({ error: error.message || `DinoStorage ${action} failed.` });
  }
}

router.post('/dinostorage/store', (req, res) => dinoAction(req, res, 'store'));
router.post('/dinostorage/redeem', (req, res) => dinoAction(req, res, 'redeem'));

router.get('/requests/:id', (req, res) => {
  try {
    const steamId = validateSteamId(req.query.steamId);
    const request = store.getRequest(String(req.params.id || '').trim());
    if (!request || request.steam_id !== steamId) return res.status(404).json({ error: 'Automation request not found.' });
    res.json({ request });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
