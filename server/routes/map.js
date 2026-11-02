const express = require("express");
const { requireAuth } = require("../middleware/requireAuth");
const serverStatus = require("../services/serverStatus");
const automation = require("../services/automationWebsiteClient");
const {
  project,
  toLatLong,
  nearestRegion,
  gridCell,
  fromRconLocation,
  BOUNDS,
  REGIONS,
} = require("../evrimaMap");

const router = express.Router();

// Region name anchors projected once at startup so the client can label the
// map without shipping the coordinate table itself.
const REGION_LABELS = REGIONS.map(([name, lat, long]) => ({
  name,
  position: project(lat * 1000, long * 1000),
}));

function vitals(character) {
  return {
    growth: character.growth,
    health: character.health,
    stamina: character.stamina,
    hunger: character.hunger,
    thirst: character.thirst,
  };
}

// Full detail including exact position - only ever used for the requesting
// user's own character, or for admins (who need it for moderation).
function toDetailedEntry(character) {
  const { x, y, z } = fromRconLocation(character.location);
  return {
    name: character.name,
    species: character.species,
    gender: character.gender,
    isPrime: character.isPrime,
    mutations: character.mutations,
    ...vitals(character),
    position: project(x, y),
    coords: toLatLong(x, y),
    altitude: Number.isFinite(z) ? Math.round(z / 1000) : null,
    region: nearestRegion(x, y),
    grid: gridCell(x, y),
  };
}

// Deliberately position-free. Broadcasting every player's live location would
// turn this page into a server-wide wallhack, so other survivors are listed by
// name/species only - never coordinates, never SteamIDs.
function toPublicEntry(character) {
  return {
    name: character.name,
    species: character.species,
    isPrime: character.isPrime,
  };
}

router.get("/activity", async (req, res) => {
  try {
    const hours = Math.max(1, Math.min(24 * 31, Number(req.query.hours) || 24));
    return res.json(await automation.getMapActivity({ hours }));
  } catch (error) {
    return res.status(502).json({
      error: error?.message || "Verified activity history is unavailable.",
      trackingEnabled: false,
      hours: 24,
      sampleCount: 0,
      uniquePlayers: 0,
      sessions: 0,
      averageOnline: 0,
      peakConcurrent: 0,
      topSpecies: [],
      activityTrend: [],
      lastVerifiedAt: null,
    });
  }
});

function recentlyVerified(checkedAt, maxAgeMs = 45_000) {
  const sampledAt = Date.parse(checkedAt || '');
  const age = Date.now() - sampledAt;
  return Number.isFinite(sampledAt) && age >= -5_000 && age <= maxAgeMs;
}

// Never derive native groups from website groups, chat, proximity or species.
async function getGroupmates(req, state, mine) {
  const unavailable = { groupmates: [], groupmatesVerified: false };
  if (process.env.GROUPMATES_API_ENABLED !== '1' || !mine ||
      state.snapshotSource !== 'external-presence' || !state.sampleId ||
      !recentlyVerified(state.lastChecked)) return unavailable;
  try {
    const resolved = await automation.getVerifiedNativeGroupmates(req.user.steam_id);
    if (resolved?.verified !== true ||
        resolved.presenceSampleId !== state.sampleId ||
        !recentlyVerified(resolved.sampledAt, 30_000) ||
        !Array.isArray(resolved.memberSteamIds)) return unavailable;
    const characters = new Map(state.characters.map((c) => [c.steamId, c]));
    const groupmates = [];
    for (const id of new Set(resolved.memberSteamIds)) {
      if (!/^\d{17}$/.test(id) || id === req.user.steam_id) continue;
      const character = characters.get(id);
      if (!character) continue;
      const { x, y } = fromRconLocation(character.location);
      const position = project(x, y);
      if (!position) continue;
      groupmates.push({ name: character.name, species: character.species, position });
    }
    return { groupmates, groupmatesVerified: true };
  } catch {
    return unavailable;
  }
}

router.get("/positions", requireAuth, async (req, res) => {
  const state = serverStatus.getState();

  if (!state.configured || !state.online) {
    return res.json({
      connected: false,
      configured: state.configured,
      linked: Boolean(req.user.steam_id),
      me: null,
      groupmates: [],
      groupmatesVerified: false,
      others: [],
      playerCount: 0,
      maxPlayers: state.maxPlayers,
      bounds: BOUNDS,
      regions: REGION_LABELS,
      lastChecked: state.lastChecked,
    });
  }

  const isAdmin = Boolean(req.user.is_admin);
  const steamId = req.user.steam_id;

  // Match the website account to the in-game character by SteamID64, which is
  // what Evrima reports as PlayerID. Users who signed in with Discord instead
  // of Steam have no steam_id and so can't be matched.
  const mine = steamId ? state.characters.find((c) => c.steamId === steamId) : null;
  const others = state.characters.filter((c) => c !== mine);
  const groupmateState = await getGroupmates(req, state, mine);

  res.json({
    connected: true,
    configured: true,
    linked: Boolean(steamId),
    me: mine ? toDetailedEntry(mine) : null,
    ...groupmateState,
    others: others.map(isAdmin ? toDetailedEntry : toPublicEntry),
    othersHavePositions: isAdmin,
    playerCount: state.playerCount,
    maxPlayers: state.maxPlayers,
    bounds: BOUNDS,
    regions: REGION_LABELS,
    lastChecked: state.lastChecked,
  });
});

module.exports = router;
