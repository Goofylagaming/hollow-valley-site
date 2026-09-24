const express = require("express");
const { requireAuth } = require("../middleware/requireAuth");
const {
  getFriendState,
  searchFriendUsers,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  cancelFriendRequest,
  removeFriend,
  blockFriendUser,
  unblockFriendUser,
} = require("../db");

const router = express.Router();

router.use(requireAuth);

function requireSteam(req, res) {
  const steamId = String(req.user?.steam_id || "").trim();
  if (!/^\d{17}$/.test(steamId)) {
    res.status(400).json({ error: "Link your Steam account before using Friends." });
    return null;
  }
  return steamId;
}

function mapError(error) {
  const code = error?.code || "";
  if (code === "FRIEND_REQUEST_NOT_FOUND") return 404;
  if (code === "FRIEND_BLOCKED") return 409;
  return 400;
}

router.get("/", (req, res) => {
  const steamId = requireSteam(req, res);
  if (!steamId) return;
  try {
    return res.json(getFriendState(steamId));
  } catch (error) {
    return res.status(mapError(error)).json({ error: error.message || "Could not load friends." });
  }
});

router.get("/search", (req, res) => {
  const steamId = requireSteam(req, res);
  if (!steamId) return;
  try {
    return res.json({ results: searchFriendUsers(steamId, req.query.q || "", { limit: 30 }) });
  } catch (error) {
    return res.status(mapError(error)).json({ error: error.message || "Could not search players." });
  }
});

router.post("/requests", (req, res) => {
  const steamId = requireSteam(req, res);
  if (!steamId) return;
  try {
    const result = sendFriendRequest(steamId, req.body?.steamId);
    return res.status(result?.accepted ? 200 : 201).json(result);
  } catch (error) {
    return res.status(mapError(error)).json({ error: error.message || "Could not send friend request." });
  }
});

router.post("/requests/:id/accept", (req, res) => {
  const steamId = requireSteam(req, res);
  if (!steamId) return;
  try {
    return res.json(acceptFriendRequest(steamId, req.params.id));
  } catch (error) {
    return res.status(mapError(error)).json({ error: error.message || "Could not accept friend request." });
  }
});

router.post("/requests/:id/decline", (req, res) => {
  const steamId = requireSteam(req, res);
  if (!steamId) return;
  try {
    return res.json(declineFriendRequest(steamId, req.params.id));
  } catch (error) {
    return res.status(mapError(error)).json({ error: error.message || "Could not decline friend request." });
  }
});

router.post("/requests/:id/cancel", (req, res) => {
  const steamId = requireSteam(req, res);
  if (!steamId) return;
  try {
    return res.json(cancelFriendRequest(steamId, req.params.id));
  } catch (error) {
    return res.status(mapError(error)).json({ error: error.message || "Could not cancel friend request." });
  }
});

router.delete("/:steamId", (req, res) => {
  const steamId = requireSteam(req, res);
  if (!steamId) return;
  try {
    return res.json(removeFriend(steamId, req.params.steamId));
  } catch (error) {
    return res.status(mapError(error)).json({ error: error.message || "Could not remove friend." });
  }
});

router.post("/:steamId/block", (req, res) => {
  const steamId = requireSteam(req, res);
  if (!steamId) return;
  try {
    return res.json(blockFriendUser(steamId, req.params.steamId));
  } catch (error) {
    return res.status(mapError(error)).json({ error: error.message || "Could not block player." });
  }
});

router.delete("/:steamId/block", (req, res) => {
  const steamId = requireSteam(req, res);
  if (!steamId) return;
  try {
    return res.json(unblockFriendUser(steamId, req.params.steamId));
  } catch (error) {
    return res.status(mapError(error)).json({ error: error.message || "Could not unblock player." });
  }
});

module.exports = router;
