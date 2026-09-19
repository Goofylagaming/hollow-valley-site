const store = require('./economyStore');
const marketplace = require('./marketplaceService');
const files = require('./parkedDinoFileService');

function enabled() {
  return String(process.env.OFFICIAL_MARKETPLACE_FULFILLMENT_ENABLED || '').toLowerCase() === 'true'
    && String(process.env.MARKETPLACE_WRITE_ENABLED || '').toLowerCase() === 'true';
}

function intervalMs() {
  const value = Number(process.env.OFFICIAL_MARKETPLACE_FULFILLMENT_INTERVAL_MS || 15000);
  return Math.max(5000, Math.min(300000, Number.isFinite(value) ? value : 15000));
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
  const slot = state.slot;

  try {
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
      slot,
      classPath: state.classPath,
      growth: state.growth,
    });
    return { duplicate: false, order: fulfilled };
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
  if (!enabled()) return { skipped: true, checked: 0, fulfilled: 0, refunded: 0, errors: [] };
  const pending = store.listOrders({ statuses: ['pending'], limit: 100 });
  let fulfilled = 0;
  let refunded = 0;
  const errors = [];

  for (const order of pending) {
    try {
      const result = await fulfillOrder(order.id);
      if (result.refunded) refunded += 1;
      else if (result.order?.status === 'fulfilled') fulfilled += 1;
    } catch (error) {
      errors.push({ orderId: order.id, error: error.message });
    }
  }

  return { skipped: false, checked: pending.length, fulfilled, refunded, errors };
}

function startOfficialMarketplaceFulfillment() {
  const timer = setInterval(() => {
    reconcilePendingOrders().catch((error) => console.warn('[official-marketplace-fulfillment]', error.message));
  }, intervalMs());
  timer.unref?.();
  return timer;
}

module.exports = {
  enabled,
  intervalMs,
  slotForOrder,
  validateDinoOrder,
  buildStoredState,
  fulfillOrder,
  reconcilePendingOrders,
  startOfficialMarketplaceFulfillment,
};
