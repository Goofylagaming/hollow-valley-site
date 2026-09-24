const store = require('./economyStore');
const marketplace = require('./marketplaceService');
const files = require('./parkedDinoFileService');
const commandBridge = require('./commandBridgeService');
const httpBridge = require('./commandBridgeHttpService');

const BRIDGE_RETRY_MS = 300000;

function enabled() {
  return String(process.env.OFFICIAL_MARKETPLACE_FULFILLMENT_ENABLED || '').toLowerCase() === 'true'
    && String(process.env.MARKETPLACE_WRITE_ENABLED || '').toLowerCase() === 'true';
}

function intervalMs() {
  const value = Number(process.env.OFFICIAL_MARKETPLACE_FULFILLMENT_INTERVAL_MS || 15000);
  return Math.max(5000, Math.min(300000, Number.isFinite(value) ? value : 15000));
}

function deliveryTransport() {
  try {
    return commandBridge.getTransport() === 'http_pull' ? 'command_bridge' : 'file_bridge';
  } catch {
    return 'file_bridge';
  }
}

function slotForOrder(orderId) {
  const compact = String(orderId || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
  if (!compact) throw new Error('Official marketplace order ID is invalid');
  return `shop_${compact}`;
}

function validateDinoOrder(order) {
  const item = order?.itemSnapshot || {};
  const payload = item.payload || {};
  if (item.itemType !== 'dino') {
    const error = new Error('Official marketplace order is not a dinosaur item');
    error.code = 'OFFICIAL_ORDER_INVALID';
    throw error;
  }
  const classPath = String(payload.classPath || '').trim();
  const growth = Number(payload.growth);
  if (!/^\/Game\/TheIsle\/Core\/Characters\/Dinosaurs\/[A-Za-z0-9_]+\/BP_[A-Za-z0-9_]+\.BP_[A-Za-z0-9_]+_C$/.test(classPath)) {
    const error = new Error('Official marketplace dinosaur class path is invalid');
    error.code = 'OFFICIAL_ORDER_INVALID';
    throw error;
  }
  if (!Number.isFinite(growth) || growth <= 0 || growth > 1) {
    const error = new Error('Official marketplace dinosaur growth is invalid');
    error.code = 'OFFICIAL_ORDER_INVALID';
    throw error;
  }
  return {
    classPath,
    growth,
    speciesId: String(payload.speciesId || '').trim(),
    species: String(payload.species || item.name || 'Dinosaur').trim(),
    isPrime: Boolean(payload.isPrime),
  };
}

function buildStoredState(order) {
  const dino = validateDinoOrder(order);
  const slot = slotForOrder(order.id);
  return {
    version: 2,
    slot,
    capturedAt: Math.floor(Date.now() / 1000),
    classPath: dino.classPath,
    growth: dino.growth,
    ...(dino.isPrime ? { isPrime: true, primeData: { eligible: true, cond1: true, cond2: true } } : {}),
    marketplacePurchase: {
      orderId: order.id,
      catalogId: order.catalog_id,
      speciesId: dino.speciesId,
    },
  };
}

function sameOrderMarker(state, orderId) {
  return state?.marketplacePurchase?.orderId === orderId;
}

function fulfillmentMeta(order, state, extra = {}) {
  return {
    ...(order.fulfillment && typeof order.fulfillment === 'object' ? order.fulfillment : {}),
    transport: deliveryTransport(),
    slot: state.slot,
    classPath: state.classPath,
    growth: state.growth,
    ...extra,
  };
}

function permanentBridgeFailure(message) {
  return /target slot contains another|invalid (?:slot|class|growth)|order mismatch|another dinosaur/i.test(String(message || ''));
}

function resultPayload(row) {
  if (!row?.result_json) return null;
  try { return JSON.parse(row.result_json); } catch { return null; }
}

function bridgeTokens(order, state) {
  const dino = validateDinoOrder(order);
  return [
    state.slot,
    state.classPath,
    Number(state.growth).toFixed(6),
    dino.isPrime ? '1' : '0',
    order.id,
    order.catalog_id,
    dino.speciesId || '-',
  ];
}

async function fulfillViaCommandBridge(order, state) {
  const progress = order.fulfillment && typeof order.fulfillment === 'object' ? order.fulfillment : {};
  const now = Date.now();
  const retryAfter = progress.retryAfter ? Date.parse(progress.retryAfter) : 0;

  if (progress.commandId) {
    const row = httpBridge.getRequest(progress.commandId);
    if (row && row.status !== 'completed') {
      return { queued: true, pending: true, order };
    }

    if (row && row.status === 'completed') {
      const result = resultPayload(row);
      if (result?.ok === true && result?.source === 'DinoStorage') {
        const fulfilled = marketplace.markOrderFulfilled(order.id, fulfillmentMeta(order, state, {
          commandId: progress.commandId,
          commandStatus: 'completed',
          deliveredAt: new Date().toISOString(),
          lastError: null,
          retryAfter: null,
        }));
        return { duplicate: false, order: fulfilled };
      }

      const message = String(result?.msg || 'DinoStorage delivery command failed');
      if (permanentBridgeFailure(message)) {
        marketplace.markOrderFailed(order.id, message);
        const refund = marketplace.refundOrder(order.id, `Official marketplace fulfillment refund: ${message}`);
        return { failed: true, refunded: true, order: refund.order };
      }

      marketplace.updateOrderFulfillmentProgress(order.id, fulfillmentMeta(order, state, {
        commandId: null,
        commandStatus: 'retry_wait',
        lastError: message,
        retryAfter: new Date(now + BRIDGE_RETRY_MS).toISOString(),
      }));
      return { queued: false, pending: true, retrying: true, order: store.getOrder(order.id) };
    }

    marketplace.updateOrderFulfillmentProgress(order.id, fulfillmentMeta(order, state, {
      commandId: null,
      commandStatus: 'missing',
      lastError: 'Delivery command state was missing; queued for safe retry.',
      retryAfter: new Date(now + BRIDGE_RETRY_MS).toISOString(),
    }));
    return { queued: false, pending: true, retrying: true, order: store.getOrder(order.id) };
  }

  if (retryAfter && retryAfter > now) {
    return { queued: false, pending: true, retrying: true, order };
  }

  const command = commandBridge.buildCommand('dino_grant', order.steam_id, bridgeTokens(order, state));
  await commandBridge.queueCommand(command);
  const updated = marketplace.updateOrderFulfillmentProgress(order.id, fulfillmentMeta(order, state, {
    commandId: command.id,
    commandStatus: 'queued',
    queuedAt: new Date().toISOString(),
    retryAfter: null,
    lastError: null,
  }));
  return { queued: true, pending: true, commandId: command.id, order: updated };
}

async function fulfillViaFileBridge(order, state) {
  const slot = state.slot;
  if (await files.storedExists(order.steam_id, slot)) {
    const existing = await files.readStoredDino(order.steam_id, slot);
    if (!sameOrderMarker(existing, order.id)) {
      const error = new Error('Official marketplace target slot contains another dinosaur');
      error.code = 'DINO_TARGET_EXISTS';
      throw error;
    }
  } else {
    await files.createStoredDino(order.steam_id, slot, state);
  }

  const fulfilled = marketplace.markOrderFulfilled(order.id, {
    transport: 'file_bridge',
    slot,
    classPath: state.classPath,
    growth: state.growth,
  });
  return { duplicate: false, order: fulfilled };
}

async function fulfillOrder(orderId) {
  if (!enabled()) {
    const error = new Error('Official marketplace fulfillment is disabled');
    error.code = 'OFFICIAL_MARKETPLACE_FULFILLMENT_DISABLED';
    throw error;
  }

  const order = store.getOrder(orderId);
  if (!order) throw new Error('Marketplace order not found');
  if (order.status === 'fulfilled') return { duplicate: true, order };
  if (order.status === 'refunded') return { duplicate: true, order };
  if (order.status !== 'pending') throw new Error(`Cannot fulfill marketplace order in status ${order.status}`);

  const state = buildStoredState(order);

  try {
    if (deliveryTransport() === 'command_bridge') {
      return await fulfillViaCommandBridge(order, state);
    }
    return await fulfillViaFileBridge(order, state);
  } catch (error) {
    if (error.code === 'OFFICIAL_ORDER_INVALID' || error.code === 'DINO_TARGET_EXISTS') {
      marketplace.markOrderFailed(order.id, error.message);
      const refund = marketplace.refundOrder(order.id, `Official marketplace fulfillment refund: ${error.message}`);
      return { failed: true, refunded: true, order: refund.order };
    }
    throw error;
  }
}

async function reconcilePendingOrders() {
  if (!enabled()) return { skipped: true, checked: 0, fulfilled: 0, queued: 0, refunded: 0, errors: [] };
  const pending = store.listOrders({ statuses: ['pending'], limit: 100 });
  let fulfilled = 0;
  let queued = 0;
  let refunded = 0;
  const errors = [];

  for (const order of pending) {
    try {
      const result = await fulfillOrder(order.id);
      if (result.refunded) refunded += 1;
      else if (result.order?.status === 'fulfilled') fulfilled += 1;
      else if (result.queued) queued += 1;
    } catch (error) {
      errors.push({ orderId: order.id, error: error.message });
    }
  }

  return { skipped: false, checked: pending.length, fulfilled, queued, refunded, errors };
}

function startOfficialMarketplaceFulfillment() {
  const timer = setInterval(() => {
    reconcilePendingOrders().catch((error) => console.warn('[official-marketplace-fulfillment]', error.message));
  }, intervalMs());
  timer.unref?.();

  setTimeout(() => {
    reconcilePendingOrders().catch((error) => console.warn('[official-marketplace-fulfillment-startup]', error.message));
  }, 3000).unref?.();

  return timer;
}

module.exports = {
  enabled,
  intervalMs,
  deliveryTransport,
  slotForOrder,
  validateDinoOrder,
  buildStoredState,
  sameOrderMarker,
  bridgeTokens,
  fulfillOrder,
  reconcilePendingOrders,
  startOfficialMarketplaceFulfillment,
};
