"use strict";

const express = require("express");
const { timingSafeEqual } = require("node:crypto");
const management = require("../services/serverManagement");
const growth = require("../services/persistentGrowth");

// Owner endpoints MUST also be mounted behind requireFinanceOwner in index.js.
const ownerRouter = express.Router();
const agentRouter = express.Router();

function rejectError(res, error) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  if (status === 500) console.error("[hv-management] internal error:", error?.message);
  res.status(status).json({ error: status === 500 ? "Management operation failed." : error.message });
}

function requireAgent(req, res, next) {
  res.set("Cache-Control", "no-store");
  if (!management.tokenConfigured()) return res.status(404).json({ error: "Not found" });
  const expected = Buffer.from(String(process.env.HV_MANAGEMENT_AGENT_TOKEN));
  const header = String(req.get("authorization") || "");
  const provided = /^Bearer ([^\s]+)$/.exec(header);
  const candidate = Buffer.from(provided?.[1] || "");
  if (candidate.length !== expected.length || !timingSafeEqual(expected, candidate)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}
function sameOriginOwnerWrite(req, res, next) {
  if (!req.is("application/json")
      || req.get("x-hv-owner-action") !== (req.path === "/growth" ? "growth-config-v1" : "enable-start-v1")) {
    return res.status(403).json({ error: "Invalid management request headers." });
  }
  try {
    const origin = new URL(String(req.get("origin") || ""));
    if (origin.host !== String(req.get("host") || "")
        || origin.protocol !== req.protocol + ":") {
      return res.status(403).json({ error: "Cross-origin management actions are not permitted." });
    }
  } catch {
    return res.status(403).json({ error: "Origin header required." });
  }
  next();
}

ownerRouter.get("/", (_req, res) => {
  try { res.json(management.ownerOverview()); }
  catch (e) { rejectError(res, e); }
});
ownerRouter.get("/growth", (_req, res) => {
  try { res.json(growth.overview()); } catch (e) { rejectError(res, e); }
});
ownerRouter.post("/growth", sameOriginOwnerWrite, (req, res) => {
  try {
    const { multiplier, expectedHash, requestId, confirmation } = req.body || {};
    res.status(202).json({ job: growth.queue({ multiplier, expectedHash, requestId, confirmation, ownerSteamId: req.user?.steam_id }) });
  } catch (e) { rejectError(res, e); }
});
ownerRouter.post("/jobs", sameOriginOwnerWrite, (req, res) => {
  try {
    const job = management.queueAction({
      action: req.body?.action,
      target: req.body?.target,
      confirmation: req.body?.confirmation,
      ownerSteamId: req.user?.steam_id,
    });
    res.status(202).json({ job });
  } catch (e) { rejectError(res, e); }
});

agentRouter.use(requireAgent);

agentRouter.post("/status", (req, res) => {
  try {
    // Status is information, not an authority to execute arbitrary commands.
    if (JSON.stringify(req.body || {}).length > 20_000) {
      return res.status(413).json({ error: "Status payload too large." });
    }
    management.receiveHeartbeat(req.body);
    res.json({ ok: true, at: new Date().toISOString() });
  } catch (e) { rejectError(res, e); }
});
// Side-effect-free preflight for the Windows cutover. Never claims a job,
// writes a heartbeat, changes player state, or exposes any secret value.
agentRouter.get("/probe", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, writesEnabled: management.writesEnabled() });
});

agentRouter.get("/next", (_req, res) => {
  try {
    res.json({ job: management.leaseNextJob() || growth.lease(), writesEnabled: management.writesEnabled() });
  } catch (e) { rejectError(res, e); }
});
agentRouter.post("/jobs/:id/result", (req, res) => {
  try {
    management.completeJob({
      id: req.params.id,
      leaseToken: req.body?.leaseToken,
      state: req.body?.state,
      message: req.body?.message,
    });
    res.json({ ok: true });
  } catch (e) { rejectError(res, e); }
});
agentRouter.post("/growth/:id/result", (req, res) => {
  try {
    growth.complete({ id: req.params.id, leaseToken: req.body?.leaseToken, state: req.body?.state, message: req.body?.message });
    res.json({ ok: true });
  } catch (e) { rejectError(res, e); }
});

module.exports = { ownerRouter, agentRouter };
