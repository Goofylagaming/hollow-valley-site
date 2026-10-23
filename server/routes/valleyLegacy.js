"use strict";
const express = require("express");
const { requireAuth } = require("../middleware/requireAuth");
const automation = require("../services/automationWebsiteClient");
const router = express.Router();
router.use((_req, res, next) =>
  process.env.VALLEY_LEGACY_ENABLED === "1"
    ? next()
    : res.status(503).json({ error: "Valley Legacy is not enabled yet" }),
);
const run = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (e) {
    res
      .status(e.status || 502)
      .json({
        error: e.status
          ? e.message
          : "Valley Legacy is temporarily unavailable",
      });
  }
};
router.get(
  "/",
  run(() => automation.legacyRequest("/overview")),
);
router.use(requireAuth);
router.use((req, res, next) =>
  /^\d{17}$/.test(String(req.user.steam_id || ""))
    ? next()
    : res.status(403).json({ error: "Sign in with Steam first" }),
);
router.get(
  "/me",
  run((r) => automation.legacyRequest(`/players/${r.user.steam_id}`)),
);
router.use((req, res, next) => {
  if (!["POST", "PUT", "DELETE", "PATCH"].includes(req.method)) return next();
  // Reject browser cross-site writes; same-origin fetch sets this header.
  if (
    req.get("X-Valley-Legacy") !== "1" ||
    req.get("Sec-Fetch-Site") === "cross-site"
  )
    return res
      .status(403)
      .json({ error: "Use the Valley Legacy page to make this change" });
  next();
});
router.post(
  "/nests",
  run((r) =>
    automation.legacyRequest("/nests", {
      method: "POST",
      body: {
        parent: r.body.parent,
        name: r.body.name,
        eggs: r.body.eggs,
        steamId: r.user.steam_id,
      },
    }),
  ),
);
router.post(
  "/nests/:id/request",
  run((r) =>
    automation.legacyRequest(
      `/nests/${encodeURIComponent(r.params.id)}/request`,
      {
        method: "POST",
        body: { steamId: r.user.steam_id, name: r.user.username },
      },
    ),
  ),
);
router.post(
  "/nests/:id/manage",
  run((r) =>
    automation.legacyRequest(
      `/nests/${encodeURIComponent(r.params.id)}/manage`,
      {
        method: "POST",
        body: {
          steamId: r.user.steam_id,
          action: r.body.action,
          requestId: r.body.requestId,
        },
      },
    ),
  ),
);
module.exports = router;
