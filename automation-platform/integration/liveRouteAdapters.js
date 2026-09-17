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

async function listDinos(req, res) {
  const steamId = requireLoggedInSteam(req, res);
  if (!steamId) return;
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
  const steamId = requireLoggedInSteam(req, res);
  if (!steamId) return;

  try {
    const cooldownResult = await automation.getBodyDropCooldown(steamId);
    const cooldown = cooldownResult.cooldown || { active: false, remainingSeconds: 0 };
    const latest = cooldown.latest || null;
    return res.json({
      enabled: true,
      steamLinked: true,
      serverOnline: true,
      cooldownSeconds: Number(process.env.BODYDROP_COOLDOWN_SECONDS || 900),
      cooldown,
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
  listDinos,
  parkActive,
  redeemStored,
  runDinoAction,
  getBodyDropState,
  requestBodyDrop,
  getAutomationRequest,
};
