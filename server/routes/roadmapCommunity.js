"use strict";
const express = require("express");
const { requireAuth, requireAdmin } = require("../middleware/requireAuth");
const community = require("../services/roadmapCommunity");

const router = express.Router();

function actorSteamId(req) {
  const id = req.user && req.user.steam_id;
  return typeof id === "string" && /^\d{17}$/.test(id) ? id : null;
}
function sameOriginJson(req, res, next) {
  // SameSite cookies and an exact Origin check prevent cross-site ballot writes.
  const origin = req.get("Origin");
  const expected = req.protocol + "://" + req.get("Host");
  if (!origin || origin !== expected) {
    return res.status(403).json({ error: "Requests must come from this Hollow Valley website." });
  }
  if (!req.is("application/json")) {
    return res.status(415).json({ error: "Send JSON data to submit a vote or suggestion." });
  }
  next();
}
function respondError(res, error) {
  const code = error && error.code;
  const status = code === "VOTE_LIMIT" || code === "SUGGESTION_LIMIT" ? 429
    : code === "SUGGESTION_DUPLICATE" || code === "SUGGESTION_NOT_PENDING" ? 409
    : code === "INVALID_BALLOT" || code === "FEATURE_NOT_VOTABLE" || code === "INVALID_SUGGESTION" || code === "INVALID_MODERATION" || code === "STEAM_REQUIRED" ? 400
    : 500;
  if (status === 500) console.error("[roadmap] write error", error);
  return res.status(status).json({
    error: status === 500 ? "The roadmap service could not complete that request." : error.message,
    code: status === 500 ? "ROADMAP_UNAVAILABLE" : code,
  });
}
function requireLinkedSteam(req, res, next) {
  if (!actorSteamId(req)) {
    return res.status(403).json({
      error: "Link your Steam account to vote or suggest ideas.",
      code: "STEAM_REQUIRED",
    });
  }
  next();
}

router.get("/votes", (req, res) => {
  try { return res.json(community.voteSummary(actorSteamId(req))); }
  catch (error) { return respondError(res, error); }
});
router.post("/votes", requireAuth, requireLinkedSteam, sameOriginJson, (req, res) => {
  try {
    // No voting on design-stage milestones or active Territory Wars.
    const featureId = req.body && req.body.featureId;
    const selected = req.body && req.body.selected;
    return res.json(community.setVote(actorSteamId(req), featureId, selected));
  } catch (error) { return respondError(res, error); }
});
router.get("/suggestions", (_req, res) => {
  try { return res.json({ suggestions: community.approvedSuggestions() }); }
  catch (error) { return respondError(res, error); }
});
router.post("/suggestions", requireAuth, requireLinkedSteam, sameOriginJson, (req, res) => {
  try {
    return res.status(201).json(community.submitSuggestion(
      actorSteamId(req), req.body && req.body.title, req.body && req.body.description
    ));
  } catch (error) { return respondError(res, error); }
});
router.get("/admin/suggestions", requireAdmin, (_req, res) => {
  try { return res.json({ suggestions: community.adminSuggestions() }); }
  catch (error) { return respondError(res, error); }
});
router.post("/admin/suggestions/:id", requireAdmin, requireLinkedSteam, sameOriginJson, (req, res) => {
  try {
    return res.json(community.moderateSuggestion(Number(req.params.id), req.body && req.body.decision, actorSteamId(req)));
  } catch (error) { return respondError(res, error); }
});
module.exports = router;
