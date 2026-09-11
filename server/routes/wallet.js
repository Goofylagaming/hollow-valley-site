const express = require("express");
const { getWallet } = require("../db");
const { requireAuth } = require("../middleware/requireAuth");

const router = express.Router();

router.get("/", requireAuth, (req, res) => {
  res.json(getWallet(req.user.id));
});

module.exports = router;
