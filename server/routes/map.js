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

router.get("/positions", requireAuth, (req, res) => {
  const state = serverStatus.getState();

  if (!state.configured || !state.online) {
    return res.json({
      connected: false,
      configured: state.configured,
      linked: Boolean(req.user.steam_id),
      me: null,
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

  res.json({
    connected: true,
    configured: true,
    linked: Boolean(steamId),
    me: mine ? toDetailedEntry(mine) : null,
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
