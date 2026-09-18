const express = require('express');
const { requireWebsiteToken } = require('../middleware/websiteAuth');
const bodyDrop = require('../services/bodyDropService');
const dinoStorage = require('../services/dinoStorageService');
const audit = require('../services/auditService');
const store = require('../services/automationStore');

const router = express.Router();
router.use(requireWebsiteToken);

function validateSteamId(value) {
  const steamId = String(value || '').trim();
  if (!/^\d{17}$/.test(steamId)) throw new Error('A valid 17-digit Steam ID is required');
  return steamId;
}

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
