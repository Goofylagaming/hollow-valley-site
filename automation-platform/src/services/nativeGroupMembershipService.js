'use strict';

const crypto = require('node:crypto');
// In-memory only: restarts, loss of a native feed, or expiry must deny access.
const STEAM_ID = /^\d{17}$/;
const SAMPLE_ID = /^[A-Za-z0-9_.:@+-]{8,180}$/;
const GROUP_ID = /^[A-Za-z0-9_.:@+-]{1,128}$/;
const SOURCE = 'evrima-native-server-v1';
const MAX_GROUP_AGE_MS = 30_000;
const MAX_POSITION_AGE_MS = 45_000;
const CLOCK_SKEW_MS = 5_000;
let current = null;

function enabled() {
  // Never set until the BinaryLane publisher truly verifies native Evrima groups.
  return process.env.GROUPMATES_NATIVE_SOURCE_VERIFIED === '1';
}

function invalid(message, code = 'GROUP_SAMPLE_INVALID', status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function parseTime(value) {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    throw invalid('sampledAt must be a UTC ISO-8601 timestamp.');
  }
  const valueMs = Date.parse(value);
  if (!Number.isFinite(valueMs)) throw invalid('sampledAt is invalid.');
  return valueMs;
}

function normalize(input, nowMs) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw invalid('A full native-group snapshot is required.');
  }
  if (input.schemaVersion !== 1 || input.source !== SOURCE || input.complete !== true) {
    throw invalid('The native group source and a complete version-1 snapshot are required.');
  }
  const sampleId = input.sampleId;
  const presenceSampleId = input.presenceSampleId;
  if (typeof sampleId !== 'string' || !SAMPLE_ID.test(sampleId) ||
      typeof presenceSampleId !== 'string' || !SAMPLE_ID.test(presenceSampleId)) {
    throw invalid('Valid sampleId and corresponding presenceSampleId are required.');
  }
  const sampledAtMs = parseTime(input.sampledAt);
  if (sampledAtMs > nowMs + CLOCK_SKEW_MS || nowMs - sampledAtMs > MAX_GROUP_AGE_MS) {
    throw invalid('Native group sample is not current.');
  }
  if (!Array.isArray(input.groups) || input.groups.length > 128) {
    throw invalid('groups must be a bounded complete roster array.');
  }
  const groupIds = new Set();
  const allMembers = new Set();
  const byMember = new Map();
  const canonicalGroups = [];
  for (const group of input.groups) {
    if (!group || typeof group !== 'object' ||
        typeof group.id !== 'string' || !GROUP_ID.test(group.id) || groupIds.has(group.id) ||
        !Array.isArray(group.members) || group.members.length < 1 || group.members.length > 32) {
      throw invalid('Every group requires a unique opaque id and 1-32 members.');
    }
    groupIds.add(group.id);
    const members = [];
    for (const member of group.members) {
      if (typeof member !== 'string' || !STEAM_ID.test(member) || allMembers.has(member)) {
        throw invalid('Each valid SteamID64 may occur in only one native group.');
      }
      allMembers.add(member);
      if (allMembers.size > 256) throw invalid('Native group snapshot exceeds player limit.');
      members.push(member);
    }
    members.sort();
    canonicalGroups.push({ id: group.id, members });
    for (const member of members) byMember.set(member, members);
  }
  canonicalGroups.sort((a, b) => a.id.localeCompare(b.id));
  const digest = crypto.createHash('sha256').update(JSON.stringify({
    sampleId, presenceSampleId, sampledAtMs, groups: canonicalGroups,
  })).digest('hex');
  return { sampleId, presenceSampleId, sampledAtMs, digest, byMember };
}

function ingest(input, { nowMs = Date.now() } = {}) {
  if (!enabled()) throw invalid('Native group tracking is disabled.', 'GROUP_SOURCE_DISABLED', 404);
  const candidate = normalize(input, nowMs);
  if (current && current.sampleId === candidate.sampleId) {
    if (current.digest !== candidate.digest) {
      throw invalid('sampleId was reused for another group roster.', 'GROUP_SAMPLE_CONFLICT', 409);
    }
    // Retries never extend a stale roster's lifetime.
    return { duplicate: true };
  }
  if (current && candidate.sampledAtMs <= current.sampledAtMs) {
    throw invalid('Out-of-order group snapshots are not accepted.', 'GROUP_SAMPLE_STALE', 409);
  }
  current = candidate;
  return { duplicate: false };
}

function unavailable() {
  return { verified: false, memberSteamIds: [], presenceSampleId: null };
}

function groupmatesFor(steamId, presence, { nowMs = Date.now() } = {}) {
  if (!enabled() || !STEAM_ID.test(String(steamId || '')) || !current) return unavailable();
  if (nowMs - current.sampledAtMs > MAX_GROUP_AGE_MS ||
      current.sampledAtMs > nowMs + CLOCK_SKEW_MS) return unavailable();
  // Require the SAME authoritative BinaryLane presence tick. Never RCON fallback.
  if (!presence || !presence.online || presence.source !== 'external-presence' ||
      presence.stale || presence.error || presence.sampleId !== current.presenceSampleId) {
    return unavailable();
  }
  const presenceMs = Date.parse(presence.checkedAt || '');
  if (!Number.isFinite(presenceMs) || presenceMs > nowMs + CLOCK_SKEW_MS ||
      nowMs - presenceMs > MAX_POSITION_AGE_MS) return unavailable();
  const onlineIds = new Set((presence.characters || []).map((player) => player.steamId));
  if (!onlineIds.has(steamId)) return unavailable();
  return {
    verified: true,
    presenceSampleId: current.presenceSampleId,
    sampledAt: new Date(current.sampledAtMs).toISOString(),
    memberSteamIds: (current.byMember.get(steamId) || [])
      .filter((id) => id !== steamId && onlineIds.has(id)),
  };
}

function resetForTests() { current = null; }
module.exports = { enabled, ingest, groupmatesFor, resetForTests };
