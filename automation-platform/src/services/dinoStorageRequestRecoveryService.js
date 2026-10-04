const dinoStorage = require('./dinoStorageService');
const store = require('./automationStore');

const ACTIVE_STATUSES = Object.freeze([
  'preparing',
  'publishing',
  'queued',
  'acknowledged',
  'unknown',
]);
const ACTIVE_STATUS_SET = new Set(ACTIVE_STATUSES);
let staleSweepTimer = null;

function validateRequestId(value) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) throw new Error('A valid DinoStorage request ID is required');
  return id;
}

function staleAfterMs(env = process.env) {
  const seconds = Number(env.DINOSTORAGE_STALE_UNLOCK_SECONDS ?? 300);
  const safeSeconds = Number.isFinite(seconds) ? Math.max(120, Math.min(3600, seconds)) : 300;
  return safeSeconds * 1000;
}

function sweepIntervalMs(env = process.env) {
  const seconds = Number(env.DINOSTORAGE_STALE_SWEEP_SECONDS ?? 30);
  const safeSeconds = Number.isFinite(seconds) ? Math.max(10, Math.min(300, seconds)) : 30;
  return safeSeconds * 1000;
}

function requestAgeMs(request, nowMs = Date.now()) {
  const timestamp = Date.parse(`${String(request?.created_at || '').replace(' ', 'T')}Z`);
  return Number.isFinite(timestamp) ? Math.max(0, nowMs - timestamp) : null;
}

function listForSteam(steamId, { limit = 100 } = {}) {
  const steam = dinoStorage.validateSteamId(steamId);
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 100));
  return store.listRequests({ kind: 'dinostorage', limit: 500 })
    .filter((request) => String(request.steam_id || '') === steam)
    .slice(0, safeLimit)
    .map((request) => ({
      ...request,
      pending: ACTIVE_STATUS_SET.has(request.status),
      ageMs: requestAgeMs(request),
    }));
}

function cancelRequest({ requestId, steamId = null, reason = 'Cancelled by Hollow Valley admin after manual DinoStorage reconciliation.' } = {}) {
  const id = validateRequestId(requestId);
  const request = store.getRequest(id);
  if (!request || request.kind !== 'dinostorage') {
    const error = new Error('DinoStorage request was not found');
    error.code = 'DINOSTORAGE_REQUEST_NOT_FOUND';
    throw error;
  }

  if (steamId) {
    const steam = dinoStorage.validateSteamId(steamId);
    if (String(request.steam_id || '') !== steam) {
      const error = new Error('DinoStorage request does not belong to that Steam ID');
      error.code = 'DINOSTORAGE_REQUEST_STEAM_MISMATCH';
      throw error;
    }
  }

  if (!ACTIVE_STATUS_SET.has(request.status)) {
    return { changed: false, request };
  }

  const now = new Date().toISOString();
  const details = {
    ...(request.details || {}),
    adminResolution: {
      type: 'cancelled',
      resolvedAt: now,
      previousStatus: request.status,
      note: String(reason || '').slice(0, 300),
      commandReplayed: false,
    },
  };

  return {
    changed: true,
    request: store.updateRequest(id, {
      status: 'cancelled',
      details,
      message: String(reason || 'Cancelled by Hollow Valley admin.'),
      error: 'ADMIN_CANCELLED_STALE_REQUEST',
    }),
  };
}

function flushPendingForSteam({ steamId, reason = 'Flushed by Hollow Valley admin after manual DinoStorage reconciliation.' } = {}) {
  const steam = dinoStorage.validateSteamId(steamId);
  const pending = listForSteam(steam, { limit: 200 }).filter((request) => request.pending);
  const requests = [];

  for (const request of pending) {
    const result = cancelRequest({ requestId: request.id, steamId: steam, reason });
    if (result.request) requests.push(result.request);
  }

  return {
    steamId: steam,
    flushed: requests.length,
    requests,
  };
}

function expireStaleRequests({ nowMs = Date.now(), maxAgeMs = staleAfterMs() } = {}) {
  const pending = store.listRequests({ kind: 'dinostorage', statuses: ACTIVE_STATUSES, limit: 500 });
  const expired = [];

  for (const request of pending) {
    const ageMs = requestAgeMs(request, nowMs);
    if (ageMs === null || ageMs < maxAgeMs) continue;

    const details = {
      ...(request.details || {}),
      adminResolution: {
        type: 'stale_unlock',
        resolvedAt: new Date(nowMs).toISOString(),
        previousStatus: request.status,
        requiresAdminReview: true,
        commandReplayed: false,
      },
    };
    const updated = store.updateRequest(request.id, {
      status: 'stale',
      details,
      message: `DinoStorage request expired from the player lock after ${Math.round(maxAgeMs / 1000)} seconds without confirmed completion. No command was retried; admin review is recommended.`,
      error: 'DINOSTORAGE_STALE_UNLOCK',
    });
    if (updated) expired.push(updated);
  }

  return { checked: pending.length, expired: expired.length, requests: expired };
}

async function reconcileRequest(requestId) {
  const id = validateRequestId(requestId);
  const before = store.getRequest(id);
  if (!before || before.kind !== 'dinostorage') {
    const error = new Error('DinoStorage request was not found');
    error.code = 'DINOSTORAGE_REQUEST_NOT_FOUND';
    throw error;
  }
  const request = await dinoStorage.reconcileDinoStorageRequest(id);
  return { before, request };
}

async function reconcileAndExpireStaleRequests() {
  let reconciliation = { checked: 0, changed: 0 };
  try {
    reconciliation = await dinoStorage.reconcileDinoStorage();
  } catch (error) {
    console.warn('[dinostorage-stale-sweep] reconcile failed:', error.message);
  }
  const stale = expireStaleRequests();
  return { reconciliation, stale };
}

function startDinoStorageStaleSweeper() {
  if (staleSweepTimer) return staleSweepTimer;
  const intervalMs = sweepIntervalMs();
  staleSweepTimer = setInterval(() => {
    reconcileAndExpireStaleRequests().catch((error) => {
      console.warn('[dinostorage-stale-sweep]', error.message);
    });
  }, intervalMs);
  staleSweepTimer.unref?.();
  return staleSweepTimer;
}

module.exports = {
  ACTIVE_STATUSES,
  ACTIVE_STATUS_SET,
  cancelRequest,
  expireStaleRequests,
  flushPendingForSteam,
  listForSteam,
  reconcileAndExpireStaleRequests,
  reconcileRequest,
  requestAgeMs,
  staleAfterMs,
  startDinoStorageStaleSweeper,
  sweepIntervalMs,
  validateRequestId,
};
