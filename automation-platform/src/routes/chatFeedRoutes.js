const express = require('express');
const { requirePresenceFeedToken } = require('../middleware/presenceFeedAuth');
const chat = require('../services/chatFeedService');

const router = express.Router();
router.post('/messages', requirePresenceFeedToken, (req, res) => {
  try {
    res.status(201).json(chat.ingest(req.body?.messages));
  } catch (error) {
    res.status(400).json({ error: error.message || 'Invalid chat feed.' });
  }
});
module.exports = router;
