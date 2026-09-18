const { randomUUID } = require('node:crypto');
const automation = require('./websiteAutomationClient');

function requireLoggedInSteam(req, res) {
  if (!req.user) {
    res.status(401).json({ error: 'Not logged in' });
    return null;
  }
  if (!req.user.steam_id) {
    res.status(400).json({ error: 'Your Steam account is not linked. Please sign in with Steam first.' });
    return null;
  }
  return String(req.user.steam_id);
}

function createSlotId() {
  return `dino-${randomUUID()}`;
}

function mapAutomationError(error, fallback = 'Automation service request failed.') {
  if (Number.isInteger(error?.status)) {
    return {
      status: error.status,
      body: {
        error: error.message || fallback,
        ...(error.payload?.cooldown ? { cooldown: error.payload.cooldown } : {}),
        ...(error.payload?.eligibility ? { eligibility: error.payload.eligibility } : {}),
        ...(error.payload?.request ? { request: error.payload.request } : {}),
      },
    };
  }

  if (error?.code === 'AUTOMATION_TIMEOUT') {
    return {
      status: 504,
      body: { error: 'The automation service did not respond in time. The request was not automatically retried.' },
    };
  }

  return { status: 502, body: { error: error?.message || fallback } };
}

async function getWallet(req, res) {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  if (!req.user.steam_id) return res.json({ balance: 0, transactions: [], steamLinked: false });
  try {
    const wallet = await automation.getWallet(String(req.user.steam_id));
    return res.json({
      balance: Number(wallet.balance) || 0,
      transactions: Array.isArray(wallet.transactions) ? wallet.transactions : [],
      earning: wallet.earning || null,
      steamLinked: true,
    });
  } catch (error) {
    const mapped = mapAutomationError(error, 'Could not read Valley Coin wallet.');
    return res.status(mapped.status).json(mapped.body);
  }
}

async function getQuests(req, res) {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  if (!req.user.steam_id) return res.json({
    steamLinked: false,
    activeBoostPercent: 0,
    quests: [],
  });

  try {
    const result = await automation.getQuests(String(req.user.steam_id));
    return res.json({
      ...result,
      steamLinked: true,
      quests: (result.quests || []).map((quest) => ({
        ...quest,
        claimed: Boolean(quest.completed),
        reward: null,
        rewardType: 'playtime_boost_percent',
      })),
    });
  } catch (error) {
    const mapped = mapAutomationError(error, 'Could not read playtime quests.');
    return res.status(mapped.status).json(mapped.body);
  }
}

async function listMarketplaceCatalog(_req, res) {
  try {
    const result = await automation.listMarketplaceCatalog();
    const catalog = (result.catalog || []).map((item) => ({
      id: item.id,
      species_id: item.payload?.speciesId || item.payload?.species || item.id,
      price: Number(item.price) || 0,
      size_percent: Number(item.payload?.sizePercent ?? item.payload?.growthPercent ?? 75),
      name: item.name || null,
      item_type: item.item_type || null,
    }));
    return res.json(catalog);
  } catch (error) {
    const mapped = mapAutomationError(error, 'Could not read marketplace catalog.');
    return res.status(mapped.status).json(mapped.body);
  }
}

async function listMarketplaceOrders(req, res) {
  const steamId = requireLoggedInSteam(req, res);
  if (!steamId) return;
  try {
    const result = await automation.listMarketplaceOrders(steamId);
    return res.json(result.orders || []);
  } catch (error) {
    const mapped = mapAutomationError(error, 'Could not read marketplace orders.');
    return res.status(mapped.status).json(mapped.body);
  }
}

async function buyMarketplaceCatalogItem(req, res, catalogId) {
  const steamId = requireLoggedInSteam(req, res);
  if (!steamId) return;
  const idempotencyKey = `website-marketplace:${randomUUID()}`;

  try {
    const result = await automation.purchaseMarketplaceItem({
      steamId,
      catalogId,
      idempotencyKey,
    });
    return res.status(result.duplicate ? 200 : 202).json({
      ok: true,
      accepted: true,
      fulfilled: result.order?.status === 'fulfilled',
      order: result.order || null,
      wallet: result.wallet || null,
    });
  } catch (error) {
    const mapped = mapAutomationError(error, 'Marketplace purchase failed.');
    return res.status(mapped.status).json(mapped.body);
  }
}

async function getActiveCharacter(req, res) {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  if (!req.user.steam_id) return res.json({ active: false, reason: 'steam_not_linked' });
  const steamId = String(req.user.steam_id);

  try {
    const result = await automation.getActiveCharacter(steamId);
    return res.json(result);
  } catch (error) {
    const mapped = mapAutomationError(error, 'Live character state unavailable.');
    return res.status(mapped.status).json(mapped.body);
  }
}

async function listDinos(req, res) {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  if (!req.user.steam_id) return res.json([]);
  const steamId = String(req.user.steam_id);
  try {
    const result = await automation.listStoredDinos(steamId);
    return res.json(result.dinos || []);
  } catch (error) {
    const mapped = mapAutomationError(error, 'Could not read DinoStorage.');
    return res.status(mapped.status).json(mapped.body);
  }
}

async function runDinoAction(req, res, action, slot) {
  const steamId = requireLoggedInSteam(req, res);
  if (!steamId) return;

  try {
    const result = await automation.requestDinoAction(action, { steamId, slot });
    const request = result.request || null;
    const message = request?.message || `DinoStorage ${action} accepted for processing.`;
    return res.status(202).json({
      ok: true,
      action,
      slot,
      message,
      result: {
        ok: false,
        accepted: true,
        queued: true,
        confirmed: false,
        completionConfirmed: false,
        requestId: request?.id || null,
        action,
        slot,
        message,
      },
    });
  } catch (error) {
    const mapped = mapAutomationError(error, `DinoStorage ${action} failed.`);
    return res.status(mapped.status).json(mapped.body);
  }
}

function parkActive(req, res) {
  return runDinoAction(req, res, 'store', createSlotId());
}

function redeemStored(req, res, slot) {
  return runDinoAction(req, res, 'redeem', slot);
}

async function getBodyDropState(req, res, { options = [] } = {}) {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  if (!req.user.steam_id) {
    return res.json({
      enabled: false,
      steamLinked: false,
      serverOnline: false,
      cooldownSeconds: Number(process.env.BODYDROP_COOLDOWN_SECONDS || 900),
      cooldown: { active: false, nextAvailableAt: null, remainingSeconds: 0 },
      eligibility: { eligible: false, reason: null },
      restrictions: { carnivoreOnly: true, maxGrowthPercent: 60 },
      options,
      latest: null,
      recent: [],
    });
  }
  const steamId = String(req.user.steam_id);

  try {
    const cooldownResult = await automation.getBodyDropCooldown(steamId);
    const cooldown = cooldownResult.cooldown || { active: false, remainingSeconds: 0 };
    const latest = cooldown.latest || null;
    return res.json({
      enabled: true,
      steamLinked: true,
      serverOnline: cooldownResult.serverOnline !== false,
      cooldownSeconds: Number(process.env.BODYDROP_COOLDOWN_SECONDS || 900),
      cooldown,
      eligibility: cooldownResult.eligibility || { eligible: false, reason: null },
      restrictions: cooldownResult.restrictions || { carnivoreOnly: true, maxGrowthPercent: 60 },
      options,
      latest,
      recent: latest ? [latest] : [],
    });
  } catch (error) {
    const mapped = mapAutomationError(error, 'Could not read BodyDrop state.');
    return res.status(mapped.status).json(mapped.body);
  }
}

async function requestBodyDrop(req, res) {
  const steamId = requireLoggedInSteam(req, res);
  if (!steamId) return;

  const dropType = String(req.body?.dropType || '').trim();
  if (!dropType) return res.status(400).json({ error: 'Unknown body drop type.' });

  try {
    const result = await automation.requestBodyDrop({ steamId, dropType });
    const request = result.request || null;
    return res.status(202).json({
      ok: true,
      request,
      result: {
        ok: false,
        accepted: true,
        queued: true,
        confirmed: false,
        requestId: request?.id || null,
        message: request?.message || 'BodyDrop request accepted for automation processing.',
      },
    });
  } catch (error) {
    const mapped = mapAutomationError(error, 'BodyDrop request failed.');
    return res.status(mapped.status).json(mapped.body);
  }
}

async function getAutomationRequest(req, res, requestId) {
  const steamId = requireLoggedInSteam(req, res);
  if (!steamId) return;
  try {
    const result = await automation.getRequestStatus(requestId, steamId);
    return res.json(result);
  } catch (error) {
    const mapped = mapAutomationError(error, 'Could not read automation request status.');
    return res.status(mapped.status).json(mapped.body);
  }
}

module.exports = {
  createSlotId,
  mapAutomationError,
  getWallet,
  getQuests,
  listMarketplaceCatalog,
  listMarketplaceOrders,
  buyMarketplaceCatalogItem,
  getActiveCharacter,
  listDinos,
  parkActive,
  redeemStored,
  runDinoAction,
  getBodyDropState,
  requestBodyDrop,
  getAutomationRequest,
};
