"use strict";

// Admin-only view models: never forward raw audit details, messages, credentials,
// free-text command payloads or raw request metadata to the browser.
const AUDIT_LIMIT = 200;
const REQUEST_LIMIT = 100;
const MAX_RESULTS = 100;

function bounded(value, max = 120) {
  return String(value ?? "").trim().slice(0, max);
}

function steamId(value) {
  const result = bounded(value, 30);
  return /^\d{17}$/.test(result) ? result : null;
}

function date(value) {
  const candidate = bounded(value, 40);
  if (!candidate || !Number.isFinite(Date.parse(candidate))) return null;
  return new Date(candidate).toISOString();
}

function label(value, max = 80) {
  // Do not display raw exception messages, details or arbitrary player chat.
  return bounded(value, max).replace(/[\u0000-\u001f\u007f]/g, " ");
}

function normalizeAudit(row) {
  if (!row || typeof row !== "object") return null;
  const details = row.details && typeof row.details === "object" && !Array.isArray(row.details)
    ? row.details : {};
  const createdAt = date(row.created_at || row.createdAt);
  if (!createdAt) return null;
  return {
    source: "audit",
    id: bounded(row.id, 90),
    at: createdAt,
    category: label(row.category || "operation"),
    action: label(row.action || "unknown"),
    status: label(row.status || "unknown", 25).toLowerCase(),
    actorSteamId: steamId(details.actorSteamId || details.adminSteamId || row.actorSteamId),
    actorName: label(details.actorName || "", 100) || null,
    playerSteamId: steamId(details.targetSteamId || details.steamId || details.playerSteamId || ""),
    reference: label(details.requestId || details.commandId || "", 90) || null,
  };
}

function normalizeRequest(row) {
  if (!row || typeof row !== "object") return null;
  const at = date(row.updated_at || row.updatedAt || row.created_at || row.createdAt);
  if (!at) return null;
  return {
    source: "request",
    id: bounded(row.id, 90),
    at,
    category: "automation request",
    action: label(row.kind || row.type || "request"),
    status: label(row.status || "unknown", 25).toLowerCase(),
    actorSteamId: null,
    actorName: null,
    playerSteamId: steamId(row.steam_id || row.steamId || row.playerSteamId || ""),
    reference: label(row.request_id || row.requestId || row.id || "", 90) || null,
  };
}

function filterTimeline(events, { source = "", status = "", q = "", limit = MAX_RESULTS } = {}) {
  const sourceFilter = ["audit", "request"].includes(source) ? source : "";
  const statusFilter = ["started", "succeeded", "failed", "pending", "completed", "unknown", "cancelled", "confirmed"].includes(status)
    ? status : "";
  const query = bounded(q).toLowerCase();
  const safeLimit = Number.isSafeInteger(Number(limit)) ? Math.max(1, Math.min(MAX_RESULTS, Number(limit))) : MAX_RESULTS;
  return events.filter(event => {
    if (sourceFilter && event.source !== sourceFilter) return false;
    if (statusFilter && event.status !== statusFilter) return false;
    if (!query) return true;
    return [
      event.id, event.at, event.category, event.action, event.status,
      event.actorSteamId, event.actorName, event.playerSteamId, event.reference,
    ].some(value => String(value || "").toLowerCase().includes(query));
  }).sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id)).slice(0, safeLimit);
}

function buildTimeline(auditRows, requestRows, filters) {
  const normalized = [
    ...auditRows.map(normalizeAudit),
    ...requestRows.map(normalizeRequest),
  ].filter(Boolean);
  return {
    events: filterTimeline(normalized, filters),
    sourceCounts: { audit: auditRows.length, requests: requestRows.length },
    hasMoreUnloaded: auditRows.length >= AUDIT_LIMIT || requestRows.length >= REQUEST_LIMIT,
  };
}

module.exports = { AUDIT_LIMIT, REQUEST_LIMIT, normalizeAudit, normalizeRequest, filterTimeline, buildTimeline };
