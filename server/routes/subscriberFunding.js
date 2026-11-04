"use strict";

const express = require("express");
const { isFinanceOwner } = require("../middleware/requireFinanceOwner");
const { FundingError, getDefaultService, publicFundingView } = require("../services/subscriberFunding");

function createSubscriberFundingRouters({ service = getDefaultService(), env = process.env } = {}) {
  const publicRouter = express.Router();
  const ownerRouter = express.Router();

  // Freshness is checked on every request. Do not let a CDN retain a percentage
  // after its month ends, the owner disables the bar, or reconciliation fails.
  publicRouter.use((_req, res, next) => {
    res.set("Cache-Control", "no-store, max-age=0");
    next();
  });
  publicRouter.get("/", (_req, res) => {
    try { return res.json(publicFundingView(service.getProgress())); }
    catch { return res.status(503).json(publicFundingView()); }
  });

  ownerRouter.use((req, res, next) => {
    res.set("Cache-Control", "private, no-store, max-age=0");
    res.set("Pragma", "no-cache");
    res.set("X-Robots-Tag", "noindex, nofollow");
    res.set("Vary", "Cookie");
    if (!isFinanceOwner(req.user, env)) return res.status(404).json({ error: "Not found" });
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      try {
        const origin = req.get("origin");
        // Check this serving origin, including its scheme and port. A preview
        // can inherit the production PUBLIC_SITE_URL while editing its own
        // isolated cost drafts; the reporting service separately blocks live
        // Stripe reads and public totals in preview environments.
        const expected = new URL(`${req.protocol}://${req.get("host")}`).origin;
        if (!origin || new URL(origin).origin !== origin || origin !== expected ||
            (req.get("sec-fetch-site") && req.get("sec-fetch-site") !== "same-origin")) throw new Error();
      } catch {
        return res.status(403).json({ error: "Use the owner finance page to change or refresh the Subscriber Bar.", code: "origin" });
      }
    }
    return next();
  });
  function failure(res, error) {
    const safe = error instanceof FundingError ? error : new FundingError();
    return res.status(safe.status).json({ error: safe.message, code: safe.code });
  }
  ownerRouter.get("/", (_req, res) => {
    try { return res.json(service.getOwnerState()); }
    catch (error) { return failure(res, error); }
  });
  ownerRouter.put("/", (req, res) => {
    try { return res.json(service.setConfig(req.body)); }
    catch (error) { return failure(res, error); }
  });
  ownerRouter.post("/refresh", async (_req, res) => {
    try { return res.json(await service.refresh()); }
    catch (error) { return failure(res, error); }
  });
  return { publicRouter, ownerRouter };
}

module.exports = { createSubscriberFundingRouters };
