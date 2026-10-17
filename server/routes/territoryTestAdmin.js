const express = require("express");
const { requireTerritoryAdmin } = require("../middleware/requireTerritoryAdmin");
const access = require("../services/territoryTestAccess");

const router = express.Router();
router.use(requireTerritoryAdmin);
router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store, private");
  next();
});

router.get("/search", (req, res) => {
  res.json({ ok: true, players: access.search(req.query?.q) });
});

router.get("/", (_req, res) => {
  res.json({ ok: true, testers: access.list() });
});

router.post("/", (req, res) => {
  try {
    const tester = access.add(req.body?.steamId, req.user.id);
    return res.json({ ok: true, tester, testers: access.list() });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.status ? error.message : "Could not approve tester" });
  }
});

router.delete("/:steamId", (req, res) => {
  try {
    const removed = access.remove(req.params.steamId);
    return res.json({ ok: true, removed, testers: access.list() });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.status ? error.message : "Could not remove tester" });
  }
});

module.exports = router;
