const express = require("express");
const bridge = require("../services/commandBridgeHttp");

const router = express.Router();

router.use((req, res, next) => {
  try {
    if (!bridge.isAuthorized(req.get("authorization"))) {
      return res.status(401).json({ error: "unauthorized" });
    }
    next();
  } catch (err) {
    console.error("[CommandBridge HTTP] auth configuration error", { error: err.message });
    return res.status(503).json({ error: "bridge_auth_unavailable" });
  }
});

router.get("/poll", (req, res) => {
  try {
    const payloads = bridge.claimPending(10);
    res.type("application/x-ndjson");
    res.send(payloads.length ? `${payloads.join("\n")}\n` : "");
  } catch (err) {
    console.error("[CommandBridge HTTP] poll failed", { error: err.message });
    res.status(500).json({ error: "poll_failed" });
  }
});

router.post("/result", (req, res) => {
  try {
    const outcome = bridge.acceptResult(req.body);
    if (!outcome.accepted && outcome.reason === "unknown_id") {
      return res.status(202).json(outcome);
    }
    if (!outcome.accepted) return res.status(400).json(outcome);
    return res.json(outcome);
  } catch (err) {
    console.error("[CommandBridge HTTP] result failed", { error: err.message });
    res.status(500).json({ error: "result_failed" });
  }
});

module.exports = router;
