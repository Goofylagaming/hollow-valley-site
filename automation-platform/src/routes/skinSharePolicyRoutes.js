const express = require('express');
const { requireWebsiteToken } = require('../middleware/websiteAuth');
const policy = require('../services/skinSharePolicyService');

const router = express.Router();
router.use(requireWebsiteToken);

router.post('/reconcile', (req, res) => {
  try {
    const result = policy.reconcileAdminShareCodes(req.body?.adminSteamIds || []);
    return res.json({ ok: true, ...result, state: policy.getPolicyState() });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Unable to reconcile skin share codes.' });
  }
});

router.get('/state', (_req, res) => {
  try {
    return res.json({ ok: true, state: policy.getPolicyState() });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Unable to read skin share code policy.' });
  }
});

module.exports = router;
