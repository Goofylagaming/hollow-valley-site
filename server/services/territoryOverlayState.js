const { db } = require("../db");
const serverStatus = require("./serverStatus");
const { fromRconLocation, toLatLong, project, BOUNDS } = require("../evrimaMap");
const { territoryGeometry, classifyLatLong } = require("./territoryGeometry");
const {
  direction8,
  timerState,
  radarPoint,
  resolveViewMode,
  parseTime,
} = require("./territoryOverlayMath");

function latestEvent() {
  return db.prepare(`
    SELECT *
    FROM territory_events
    ORDER BY CASE status
      WHEN 'live' THEN 0
      WHEN 'paused' THEN 1
      WHEN 'scheduled' THEN 2
      ELSE 3
    END, id DESC
    LIMIT 1
  `).get() || null;
}

function activeAttack(eventId) {
  if (!eventId) return null;
  return db.prepare(`
    SELECT *
    FROM territory_attacks
    WHERE event_id = ? AND status IN ('warning', 'active')
    ORDER BY id DESC
    LIMIT 1
  `).get(Number(eventId)) || null;
}

function groupForUser(userId) {
  if (!userId) return null;
  return db.prepare(`
    SELECT g.id, g.name, g.tag, gm.role
    FROM territory_group_members gm
    JOIN territory_groups g ON g.id = gm.group_id
    WHERE gm.user_id = ?
    ORDER BY gm.joined_at DESC
    LIMIT 1
  `).get(Number(userId)) || null;
}

function groupById(groupId) {
  if (!groupId) return null;
  return db.prepare("SELECT id, name, tag FROM territory_groups WHERE id = ?")
    .get(Number(groupId)) || null;
}

function groupMatchingName(name) {
  const wanted = String(name || "").trim();
  if (!wanted) return null;
  return db.prepare(`
    SELECT id, name, tag
    FROM territory_groups
    WHERE lower(name) = lower(?) OR lower(tag) = lower(?)
    ORDER BY id DESC
    LIMIT 1
  `).get(wanted, wanted.replace(/^\[|\]$/g, "")) || null;
}

function activeLineupSteamIds(eventId, groupId, at = Date.now()) {
  if (!eventId || !groupId) return new Set();
  const rows = db.prepare(`
    SELECT u.steam_id, l.active_from
    FROM territory_event_lineups l
    JOIN users u ON u.id = l.user_id
    WHERE l.event_id = ? AND l.group_id = ?
  `).all(Number(eventId), Number(groupId));

  return new Set(rows
    .filter((row) => {
      const activeAt = parseTime(row.active_from);
      return activeAt && activeAt.getTime() <= at && /^\d{17}$/.test(String(row.steam_id || ""));
    })
    .map((row) => String(row.steam_id)));
}

function adminDefenderSteamIds(event) {
  const ownerGroup = groupMatchingName(event?.owner_name);
  if (ownerGroup || String(event?.owner_name || "").trim().toLowerCase() !== "admin") {
    return new Set();
  }
  return new Set(db.prepare(`
    SELECT steam_id
    FROM users
    WHERE is_admin = 1 AND steam_id IS NOT NULL
  `).all()
    .map((row) => String(row.steam_id || ""))
    .filter((steamId) => /^\d{17}$/.test(steamId)));
}

function eventGeometry(event) {
  if (!event) return null;
  return territoryGeometry({
    territoryName: event.territory_name,
    territoryKey: event.territory_key,
  });
}

function sideForViewer(user, group, event, attack) {
  if (!event || !attack) return "spectator";
  const groupId = Number(group?.id);
  if (groupId && groupId === Number(attack.attacker_group_id)) return "attacker";
  if (groupId && attack.defender_group_id && groupId === Number(attack.defender_group_id)) return "defender";

  const ownerGroup = groupMatchingName(event.owner_name);
  if (groupId && ownerGroup && groupId === Number(ownerGroup.id)) return "defender";
  if (!attack.defender_group_id && String(event.owner_name || "").toLowerCase() === "admin" && user?.is_admin) {
    return "defender";
  }
  return "spectator";
}

function characterize(event, attack, geometry) {
  const state = serverStatus.getState();
  const now = Date.now();
  const attackerIds = activeLineupSteamIds(event?.id, attack?.attacker_group_id, now);
  const defenderIds = attack?.defender_group_id
    ? activeLineupSteamIds(event?.id, attack?.defender_group_id, now)
    : adminDefenderSteamIds(event);

  const fighters = [];
  for (const character of Array.isArray(state?.characters) ? state.characters : []) {
    const steamId = String(character?.steamId || "");
    let side = null;
    if (attackerIds.has(steamId)) side = "attacker";
    else if (defenderIds.has(steamId)) side = "defender";
    if (!side) continue;

    const world = fromRconLocation(character?.location);
    const coords = toLatLong(world.x, world.y);
    const zone = geometry ? classifyLatLong(coords, geometry) : {
      inBattlefield: false,
      inClaim: false,
      distanceMetres: null,
    };

    let zoneBand = "outside";
    if (zone.inClaim) zoneBand = "claim";
    else if (zone.inBattlefield && Number(zone.distanceMetres) <= Number(geometry?.battlefieldRadius || 0) * 5) {
      zoneBand = "battlefield-inner";
    } else if (zone.inBattlefield) zoneBand = "battlefield-outer";

    fighters.push({
      steamId,
      name: character?.name || "Unknown fighter",
      species: character?.species || "Unknown",
      side,
      coords,
      inBattlefield: Boolean(zone.inBattlefield),
      inClaim: Boolean(zone.inClaim),
      zoneBand,
    });
  }

  return {
    online: Boolean(state?.online),
    configured: Boolean(state?.configured),
    lastChecked: state?.lastChecked || null,
    fighters,
  };
}

function centroid(entries) {
  const coords = entries.map((entry) => entry.coords).filter(Boolean);
  if (!coords.length) return null;
  const total = coords.reduce((sum, point) => ({
    lat: sum.lat + Number(point.lat),
    long: sum.long + Number(point.long),
  }), { lat: 0, long: 0 });
  return {
    lat: total.lat / coords.length,
    long: total.long / coords.length,
  };
}

function countBySide(fighters, side, field) {
  return fighters.filter((fighter) => fighter.side === side && fighter[field]).length;
}

function viewerCharacter(user, fighters, state, geometry) {
  const steamId = String(user?.steam_id || "");
  if (!/^\d{17}$/.test(steamId)) return null;

  let character = fighters.find((fighter) => fighter.steamId === steamId);
  if (!character) {
    const liveCharacter = (Array.isArray(state?.characters) ? state.characters : [])
      .find((entry) => String(entry?.steamId || "") === steamId);
    if (!liveCharacter) return null;
    const world = fromRconLocation(liveCharacter.location);
    const coords = toLatLong(world.x, world.y);
    const zone = geometry ? classifyLatLong(coords, geometry) : {
      inBattlefield: false,
      inClaim: false,
    };
    character = {
      coords,
      inBattlefield: Boolean(zone.inBattlefield),
      inClaim: Boolean(zone.inClaim),
    };
  }

  return {
    inBattlefield: Boolean(character.inBattlefield),
    inClaim: Boolean(character.inClaim),
    radar: radarPoint(character.coords, geometry),
  };
}

function attackNames(event, attack) {
  const attacker = groupById(attack?.attacker_group_id);
  const defender = groupById(attack?.defender_group_id);
  return {
    attacker: attacker?.name || event?.challenger_name || "Challenger",
    attackerTag: attacker?.tag || null,
    defender: defender?.name || event?.owner_name || "Owner",
    defenderTag: defender?.tag || null,
  };
}

function buildOverlayState(user, { requestedMode } = {}) {
  const event = latestEvent();
  const attack = activeAttack(event?.id);
  const group = groupForUser(user?.id);
  const mode = resolveViewMode(user, group, requestedMode);
  const geometry = eventGeometry(event);
  const serverState = serverStatus.getState();
  const live = characterize(event, attack, geometry);
  const viewerSide = sideForViewer(user, group, event, attack);
  const names = attackNames(event, attack);

  const battlefieldAttackers = live.fighters.filter((fighter) => fighter.side === "attacker" && fighter.inBattlefield);
  const rawAttackerBearing = geometry
    ? direction8(geometry.center, centroid(battlefieldAttackers) || geometry.center)
    : null;
  const attackerBearing = (mode === "admin" || mode === "leader" || viewerSide === "defender")
    ? rawAttackerBearing
    : null;

  const self = viewerCharacter(user, live.fighters, serverState, geometry);
  const controlOwner = Math.max(0, Math.min(100, Number(event?.owner_control ?? 100)));
  const controlChallenger = Math.max(0, Math.min(100, Number(event?.challenger_control ?? 0)));

  const base = {
    ok: true,
    generatedAt: new Date().toISOString(),
    viewer: {
      mode,
      side: viewerSide,
      role: group?.role || null,
      groupName: group?.name || null,
      groupTag: group?.tag || null,
      inBattlefield: Boolean(self?.inBattlefield),
      inClaim: Boolean(self?.inClaim),
    },
    event: event ? {
      id: Number(event.id),
      name: event.name,
      status: event.status,
      territoryName: event.territory_name,
      owner: event.owner_name,
      challenger: event.challenger_name,
      startsAt: event.starts_at,
      endsAt: event.ends_at,
      protectionUntil: event.protection_until || null,
    } : null,
    attack: attack ? {
      id: Number(attack.id),
      status: attack.status,
      attacker: names.attacker,
      attackerTag: names.attackerTag,
      defender: names.defender,
      defenderTag: names.defenderTag,
      startsAt: attack.starts_at,
      contestStartedAt: attack.contest_started_at || null,
    } : null,
    timer: timerState(event, attack),
    control: {
      owner: Math.round(controlOwner),
      challenger: Math.round(controlChallenger),
    },
    zones: geometry ? {
      territoryName: geometry.territoryName,
      battlefieldRadiusMetres: Math.round(Number(geometry.battlefieldRadius) * Number(geometry.metresPerUnit || 10)),
      claimRadiusMetres: Math.round(Number(geometry.claimRadius) * Number(geometry.metresPerUnit || 10)),
      claimToBattlefieldRatio: Math.max(0, Math.min(1, Number(geometry.claimRadius) / Number(geometry.battlefieldRadius))),
      mapCenter: project(Number(geometry.center.lat) * 1000, Number(geometry.center.long) * 1000),
      battlefieldMapRadius: {
        x: (Number(geometry.battlefieldRadius) * 1000) / (BOUNDS.maxY - BOUNDS.minY),
        y: (Number(geometry.battlefieldRadius) * 1000) / (BOUNDS.maxX - BOUNDS.minX),
      },
      claimMapRadius: {
        x: (Number(geometry.claimRadius) * 1000) / (BOUNDS.maxY - BOUNDS.minY),
        y: (Number(geometry.claimRadius) * 1000) / (BOUNDS.maxX - BOUNDS.minX),
      },
      selfRadar: self?.radar || null,
    } : null,
    intel: {
      attackerDirection: attackerBearing,
      generalized: true,
      exactOpponentPositionsExposed: false,
    },
    server: {
      online: live.online,
      configured: live.configured,
      lastChecked: live.lastChecked,
    },
  };

  if (mode === "leader" || mode === "admin") {
    const friendly = viewerSide === "attacker" ? "attacker" : "defender";
    const enemy = friendly === "attacker" ? "defender" : "attacker";
    base.leaderIntel = {
      battlefield: {
        friendly: countBySide(live.fighters, friendly, "inBattlefield"),
        opposing: countBySide(live.fighters, enemy, "inBattlefield"),
      },
      claim: {
        friendly: countBySide(live.fighters, friendly, "inClaim"),
        opposing: countBySide(live.fighters, enemy, "inClaim"),
      },
      activeLineup: {
        friendly: friendly === "attacker"
          ? activeLineupSteamIds(event?.id, attack?.attacker_group_id).size
          : (attack?.defender_group_id
              ? activeLineupSteamIds(event?.id, attack.defender_group_id).size
              : adminDefenderSteamIds(event).size),
      },
    };
  }

  if (mode === "admin") {
    base.adminIntel = {
      fighters: live.fighters.map((fighter) => ({
        name: fighter.name,
        species: fighter.species,
        side: fighter.side,
        inBattlefield: fighter.inBattlefield,
        inClaim: fighter.inClaim,
        zoneBand: fighter.zoneBand,
      })),
    };
  }

  return base;
}

module.exports = {
  buildOverlayState,
  _test: {
    latestEvent,
    activeAttack,
    groupForUser,
    groupMatchingName,
    activeLineupSteamIds,
    adminDefenderSteamIds,
    sideForViewer,
    characterize,
    centroid,
    attackNames,
  },
};
