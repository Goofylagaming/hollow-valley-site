const fileBridge = require('../adapters/fileBridge');
const commandBridge = require('./commandBridgeService');
const store = require('./automationStore');

const MAX_STORED_DINO_BYTES = 512 * 1024;
const SLOT_RE = /^[A-Za-z0-9_-]{1,80}$/;
const publishingRequests = new Set();

function validateSteamId(steamId) {
  const value = String(steamId || '').trim();
  if (!/^\d{17}$/.test(value)) throw new Error('A valid 17-digit Steam ID is required');
  return value;
}

function validateSlot(slot) {
  const value = String(slot || 'default').trim();
  if (!SLOT_RE.test(value)) throw new Error('Invalid DinoStorage slot');
  return value;
}

function speciesFromClassPath(classPath) {
  const match = /BP_([^./]+?)(?:_C)?(?:\.|$)/i.exec(String(classPath || ''));
  return match ? match[1].replace(/_C$/i, '') : 'Unknown';
}

function mutationList(mutations) {
  if (!mutations || typeof mutations !== 'object') return [];
  return [...new Set(Object.values(mutations).filter((value) => typeof value === 'string' && value && value !== 'None'))];
}

function normalizeStoredDino(state, fallbackSlot) {
  const slot = validateSlot(state?.slot || fallbackSlot);
  return {
    ...state,
    slot,
    species: speciesFromClassPath(state?.classPath),
    gender: state?.isFemale === true ? 'Female' : state?.isFemale === false ? 'Male' : null,
    mutationList: mutationList(state?.mutations),
  };
}

function isMissingDirectoryError(error) {
  return fileBridge.isMissingFtpError(error) || /no such file|not found|does not exist/i.test(String(error?.message || ''));
}

async function cdRobust(client, directory) {
  try {
    await client.cd(directory);
  } catch (absoluteError) {
    await client.cd('/');
    try {
      for (const segment of directory.split('/').filter(Boolean)) await client.cd(segment);
    } catch (relativeError) {
      if (isMissingDirectoryError(relativeError)) throw relativeError;
      relativeError.message = `${relativeError.message} (absolute CWD also failed: ${absoluteError.message})`;
      throw relativeError;
    }
  }
}

function storedDirectory(steamId) {
  return `${fileBridge.getUe4ssRemotePath()}/Mods/DinoStorage/Saved/stored/${validateSteamId(steamId)}`;
}

async function listStoredDinos(steamId) {
  if (commandBridge.getTransport() === 'http_pull') {
    return listStoredDinosViaCommandBridge(steamId);
  }
  return listStoredDinosViaFiles(steamId);
}

async function listStoredDinosViaCommandBridge(steamId) {
  const command = commandBridge.buildCommand('dino_list', validateSteamId(steamId), []);
  await commandBridge.queueCommand(command);

  // Leave time for the website's default eight-second API timeout to receive
  // an explicit error. A routing acknowledgement is not a DinoStorage list.
  const deadline = Date.now() + 7000;
  do {
    const outcome = await commandBridge.readOutcome(command);
    if (outcome?.state === 'failed') {
      throw new Error(outcome.message || 'DinoStorage list command failed');
    }
    if (outcome?.state === 'confirmed') {
      let states;
      try {
        states = JSON.parse(outcome.message);
      } catch (error) {
        throw new Error(`DinoStorage list returned invalid JSON: ${error.message}`);
      }
      if (!Array.isArray(states)) throw new Error('DinoStorage list returned a non-array result');
      const dinos = states.map((state) => {
        if (!state || typeof state !== 'object' || Array.isArray(state) ||
            typeof state.slot !== 'string' || !SLOT_RE.test(state.slot)) {
          throw new Error('DinoStorage list returned an invalid stored slot');
        }
        return normalizeStoredDino(state, state.slot);
      });
      dinos.sort((a, b) => Number(b.capturedAt || 0) - Number(a.capturedAt || 0));
      return dinos;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, remaining)));
  } while (true);

  throw new Error('DinoStorage list timed out waiting for a matching DinoStorage result');
}

async function listStoredDinosViaFiles(steamId) {
  const directory = storedDirectory(steamId);
  return fileBridge.withClient(async (client) => {
    try {
      await cdRobust(client, directory);
    } catch (error) {
      if (isMissingDirectoryError(error)) return [];
      throw error;
    }

    const entries = await client.list();
    const files = entries
      .filter((entry) => entry.isFile && entry.name.endsWith('.json') && Number(entry.size) <= MAX_STORED_DINO_BYTES)
      .map((entry) => ({ entry, slot: entry.name.slice(0, -5) }))
      .filter(({ slot }) => SLOT_RE.test(slot));

    const dinos = [];
    for (const { entry, slot } of files) {
      const sink = fileBridge.bufferWritable();
      await client.downloadTo(sink, entry.name);
      const buffer = sink.toBuffer();
      if (buffer.length > MAX_STORED_DINO_BYTES) continue;
      let state;
      try {
        state = JSON.parse(buffer.toString('utf8'));
      } catch (error) {
        throw new Error(`Stored DinoStorage slot ${slot} contains invalid JSON: ${error.message}`);
      }
      dinos.push(normalizeStoredDino(state, slot));
    }

    dinos.sort((a, b) => Number(b.capturedAt || 0) - Number(a.capturedAt || 0));
    return dinos;
  });
}

async function getStoredDino(steamId, slot) {
  const steam = validateSteamId(steamId);
  const selectedSlot = validateSlot(slot);
  const dinos = await listStoredDinos(steam);
  const found = dinos.find((dino) => dino.slot === selectedSlot);
  if (!found) {
    const error = new Error(`Stored DinoStorage slot not found: ${selectedSlot}`);
    error.code = 'DINO_FILE_NOT_FOUND';
    throw error;
  }
  return found;
}

async function runImmediateCommand({ verb, steamId, tokens = [], timeoutMs = 7000 }) {
  const steam = validateSteamId(steamId);
  commandBridge.assertPublisherReady();
  const command = commandBridge.buildCommand(verb, steam, tokens);
  await commandBridge.queueCommand(command);

  const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 7000);
  do {
    const outcome = await commandBridge.readOutcome(command);
    if (outcome?.state === 'failed') {
      const error = new Error(outcome.message || `${verb} failed`);
      error.code = 'DINOSTORAGE_COMMAND_FAILED';
      error.requestId = command.id;
      throw error;
    }
    if (outcome?.state === 'confirmed') {
      return { command, outcome };
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, remaining)));
  } while (true);

  const error = new Error(`${verb} timed out waiting for DinoStorage confirmation`);
  error.code = 'DINOSTORAGE_COMMAND_TIMEOUT';
  error.requestId = command.id;
  throw error;
}

async function editStoredDino({ steamId, slot, mode, values = {} }) {
  const selectedSlot = validateSlot(slot);
  if (!['mutations', 'skin'].includes(mode)) throw new Error('Unsupported parked dino edit mode');

  const tokens = [selectedSlot, mode];
  if (mode === 'mutations') {
    for (const key of ['Slot1', 'Slot2', 'Slot3', 'Slot4']) {
      tokens.push(`${key}=${encodeURIComponent(String(values[key] || ''))}`);
    }
  } else {
    const colorKeys = ['maleDisplay','markings','body','flank','underbelly','teeth','mouth','claws','detail1','eyes'];
    for (const key of colorKeys) {
      if (typeof values[key] !== 'string' || !/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(values[key])) {
        throw new Error(`Invalid parked skin colour token: ${key}`);
      }
      tokens.push(`${key}=${values[key]}`);
    }
    for (const key of ['skinVariation','patternIndex','themeIndex']) {
      if (!Number.isFinite(Number(values[key]))) throw new Error(`Invalid parked skin value: ${key}`);
      tokens.push(`${key}=${Number(values[key])}`);
    }
  }

  return runImmediateCommand({ verb: 'dino_edit', steamId, tokens });
}

async function deleteStoredDino({ steamId, slot }) {
  const selectedSlot = validateSlot(slot);
  return runImmediateCommand({ verb: 'dino_delete', steamId, tokens: [selectedSlot] });
}

function latestPending(steamId) {
  const latest = store.getLatestForSteam(steamId, 'dinostorage');
  return latest && ['preparing', 'publishing', 'queued', 'acknowledged', 'unknown'].includes(latest.status) ? latest : null;
}

async function publishDinoStorageRequest(requestId) {
  const id = String(requestId || '').trim();
  if (!id || publishingRequests.has(id)) return store.getRequest(id);

  const request = store.getRequest(id);
  if (!request || request.kind !== 'dinostorage' || request.status !== 'preparing') return request;

  const command = request.details?.command;
  if (!command) {
    return store.updateRequest(id, {
      status: 'unknown',
      message: 'DinoStorage request is missing its persisted command. Do not retry until an operator reconciles it.',
      error: 'Persisted command missing',
    });
  }

  publishingRequests.add(id);
  store.updateRequest(id, {
    status: 'publishing',
    message: 'DinoStorage request accepted. Publishing to CommandBridge in the background; do not retry.',
    error: null,
  });

  try {
    await commandBridge.queueCommand(command);
    return store.updateRequest(id, {
      status: 'queued',
      message: `DinoStorage ${request.details?.action || 'action'} published to CommandBridge; awaiting routing/result.`,
      error: null,
    });
  } catch (error) {
    return store.updateRequest(id, {
      status: 'unknown',
      message: `DinoStorage publication outcome is uncertain: ${error.message}. Do not retry until this request is reconciled.`,
      error: error.message,
    });
  } finally {
    publishingRequests.delete(id);
  }
}

function scheduleDinoStoragePublication(requestId) {
  setImmediate(() => {
    publishDinoStorageRequest(requestId).catch((error) => {
      console.warn('[dinostorage-publish]', String(requestId), error.message);
    });
  });
}

async function requestDinoStorageAction({ action, steamId, slot = 'default' }) {
  const steam = validateSteamId(steamId);
  const selectedSlot = validateSlot(slot);
  const verbs = { store: 'dino_store', redeem: 'dino_retrieve' };
  if (!Object.hasOwn(verbs, action)) throw new Error('Unsupported DinoStorage action');

  // Fail closed before persisting an accepted request if the sole-publisher gate
  // is not ready. Once accepted below, publication happens exactly once in the
  // background and any uncertain outcome is reconciled instead of replayed.
  commandBridge.assertPublisherReady();

  const pending = latestPending(steam);
  if (pending) {
    const error = new Error(`DinoStorage request ${pending.id} is still awaiting reconciliation`);
    error.code = 'DINOSTORAGE_PENDING';
    error.request = pending;
    throw error;
  }

  const command = commandBridge.buildCommand(verbs[action], steam, [selectedSlot]);
  const request = store.createRequest({
    id: command.id,
    kind: 'dinostorage',
    steamId: steam,
    status: 'preparing',
    commandId: command.id,
    details: { action, slot: selectedSlot, command },
    message: `DinoStorage ${action} accepted for background publication. Do not retry this request.`,
  });

  scheduleDinoStoragePublication(command.id);
  return request;
}

function recoverInterruptedDinoStorage() {
  const interrupted = store.listRequests({ kind: 'dinostorage', statuses: ['preparing', 'publishing'], limit: 500 });
  for (const request of interrupted) {
    store.updateRequest(request.id, {
      status: 'unknown',
      message: 'Automation restarted while DinoStorage publication was in progress. Outcome is uncertain; do not retry until reconciled.',
      error: request.error || 'Interrupted during publication',
    });
  }
  return interrupted.length;
}

function parseSqliteDate(value) {
  const timestamp = Date.parse(`${String(value || '').replace(' ', 'T')}Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

async function reconcileDinoStorageRequest(requestId) {
  if (process.env.COMMAND_BRIDGE_ENABLED !== 'true') return store.getRequest(String(requestId || '').trim());

  const id = String(requestId || '').trim();
  const request = store.getRequest(id);
  if (!request || request.kind !== 'dinostorage') return request;
  if (!['queued', 'acknowledged', 'unknown'].includes(request.status)) return request;

  const command = request.details?.command;
  if (!command) return request;

  const outcome = await commandBridge.readOutcome(command);
  if (!outcome) return request;

  if (outcome.state === 'failed') {
    return store.updateRequest(request.id, {
      status: 'failed',
      message: outcome.message,
      error: outcome.message,
    });
  }

  if (outcome.state === 'confirmed') {
    const action = request.details?.action || 'action';
    const deferred = action === 'store' ? 'kill' : 'restore';
    return store.updateRequest(request.id, {
      status: 'accepted',
      message: `${outcome.message} DinoStorage accepted the ${action}; the deferred in-game ${deferred} is not independently confirmed.`,
      error: null,
    });
  }

  return store.updateRequest(request.id, {
    status: 'acknowledged',
    message: outcome.message,
    error: null,
  });
}

async function reconcileDinoStorage() {
  if (process.env.COMMAND_BRIDGE_ENABLED !== 'true') return { checked: 0, changed: 0 };
  const requests = store.listRequests({ kind: 'dinostorage', statuses: ['queued', 'acknowledged', 'unknown'], limit: 200 });
  if (!requests.length) return { checked: 0, changed: 0 };

  const unknownAfterMs = Math.max(10, Number(process.env.DINOSTORAGE_UNKNOWN_AFTER_SECONDS || 60)) * 1000;
  let changed = 0;

  for (const request of requests) {
    const command = request.details?.command;
    if (!command) continue;
    const outcome = await commandBridge.readOutcome(command);

    if (outcome) {
      if (outcome.state === 'failed') {
        if (request.status !== 'failed' || request.error !== outcome.message) changed += 1;
        store.updateRequest(request.id, { status: 'failed', message: outcome.message, error: outcome.message });
      } else if (outcome.state === 'confirmed') {
        const action = request.details?.action || 'action';
        const deferred = action === 'store' ? 'kill' : 'restore';
        const message = `${outcome.message} DinoStorage accepted the ${action}; the deferred in-game ${deferred} is not independently confirmed.`;
        if (request.status !== 'accepted' || request.message !== message) changed += 1;
        store.updateRequest(request.id, { status: 'accepted', message, error: null });
      } else {
        if (request.status !== 'acknowledged' || request.message !== outcome.message) changed += 1;
        store.updateRequest(request.id, { status: 'acknowledged', message: outcome.message, error: null });
      }
      continue;
    }

    const createdAt = parseSqliteDate(request.created_at);
    if (request.status === 'queued' && createdAt && Date.now() - createdAt >= unknownAfterMs) {
      changed += 1;
      store.updateRequest(request.id, {
        status: 'unknown',
        message: 'No matching CommandBridge acknowledgement/result yet. Do not retry until this request is reconciled.',
      });
    }
  }

  return { checked: requests.length, changed };
}

function startDinoStorageReconciler() {
  const intervalMs = Math.max(2000, Number(process.env.DINOSTORAGE_RECONCILE_INTERVAL_MS || 5000));
  const timer = setInterval(() => {
    reconcileDinoStorage().catch((error) => console.warn('[dinostorage-reconcile]', error.message));
  }, intervalMs);
  timer.unref?.();
  return timer;
}

module.exports = {
  validateSteamId,
  validateSlot,
  normalizeStoredDino,
  listStoredDinos,
  getStoredDino,
  editStoredDino,
  deleteStoredDino,
  runImmediateCommand,
  requestDinoStorageAction,
  publishDinoStorageRequest,
  recoverInterruptedDinoStorage,
  reconcileDinoStorageRequest,
  reconcileDinoStorage,
  startDinoStorageReconciler,
};
