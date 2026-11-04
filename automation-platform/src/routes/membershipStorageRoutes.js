const express = require('express');
const { requireWebsiteToken } = require('../middleware/websiteAuth');
const capacity = require('../services/dinoStorageCapacityService');

const router = express.Router();
router.use(requireWebsiteToken);
router.get('/:steamId', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  try {
    res.json(await capacity.getStatus(req.params.steamId));
  } catch (error) {
    res.status(Number.isInteger(error.status) ? error.status : 503).json({
      error: error.code ? error.message : 'Storage allowances are temporarily unavailable.',
      code: error.code || 'DINOSTORAGE_CAPACITY_UNAVAILABLE',
    });
  }
});
module.exports = router;
