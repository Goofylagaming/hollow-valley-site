"use strict";

const { randomUUID } = require("node:crypto");
const METRICS = [
  "survival_seconds",
  "journey_metres",
  "offspring",
  "kill_streak",
  "rex_seconds",
  "territory_captures",
  "gameplay_coins",
  "group_battle",
];
const UNLOCKS = [5, 10, 20, 25, 35, 50];
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
function text(value, max = 80) {
  return String(value ?? "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
    .slice(0, max);
}
function steam(value) {
  const id = String(value || "");
  if (!/^\d{17}$/.test(id)) fail("A linked Steam account is required");
  return id;
}
function species(value) {
  return text(value)
    .toLowerCase()
    .replace(/^bp_/, "")
    .replace(/_c$/, "")
    .replace(/[^a-z0-9]/g, "");
}

// Additive, transactional schema. Does not alter existing game/economy tables.
function createLegacyStore(db, { now = Date.now } = {}) {
  db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS vl_seasons (id TEXT PRIMARY KEY, name TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER);
    CREATE UNIQUE INDEX IF NOT EXISTS vl_one_season ON vl_seasons((1)) WHERE ended_at IS NULL;
    CREATE TABLE IF NOT EXISTS vl_lives (id TEXT PRIMARY KEY, steam_id TEXT NOT NULL, name TEXT NOT NULL, species TEXT NOT NULL, started_at INTEGER NOT NULL, last_at INTEGER NOT NULL, ended_at INTEGER, growth REAL, location TEXT, mutations TEXT NOT NULL DEFAULT '[]', generation INTEGER NOT NULL DEFAULT 1);
    CREATE UNIQUE INDEX IF NOT EXISTS vl_one_life ON vl_lives(steam_id) WHERE ended_at IS NULL;
    CREATE INDEX IF NOT EXISTS vl_lives_player ON vl_lives(steam_id, started_at);
    CREATE TABLE IF NOT EXISTS vl_mastery (steam_id TEXT NOT NULL, species TEXT NOT NULL, seconds INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(steam_id,species));
    CREATE TABLE IF NOT EXISTS vl_records (scope TEXT NOT NULL, metric TEXT NOT NULL, subject TEXT NOT NULL, name TEXT NOT NULL, value REAL NOT NULL, achieved_at INTEGER NOT NULL, PRIMARY KEY(scope,metric,subject));
    CREATE TABLE IF NOT EXISTS vl_events (id TEXT PRIMARY KEY, payload TEXT NOT NULL, occurred_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS vl_events_player_time ON vl_events(json_extract(payload,'$.steamId'),occurred_at);
    CREATE TABLE IF NOT EXISTS vl_imports (source TEXT NOT NULL, id TEXT NOT NULL, error TEXT, PRIMARY KEY(source,id));
    CREATE TABLE IF NOT EXISTS vl_parents (child TEXT NOT NULL, parent TEXT NOT NULL, PRIMARY KEY(child,parent));
    CREATE TABLE IF NOT EXISTS vl_nests (id TEXT PRIMARY KEY, host TEXT NOT NULL, parent TEXT NOT NULL, species TEXT NOT NULL, name TEXT NOT NULL, eggs INTEGER NOT NULL CHECK(eggs BETWEEN 1 AND 12), remaining INTEGER NOT NULL CHECK(remaining>=0), status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS vl_requests (id TEXT PRIMARY KEY, nest TEXT NOT NULL, player TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, UNIQUE(nest,player));
    CREATE TABLE IF NOT EXISTS vl_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    COMMIT;`);
  const initial = now();
  db.prepare("INSERT OR IGNORE INTO vl_state VALUES ('started', ?)").run(
    String(initial),
  );
  if (!db.prepare("SELECT id FROM vl_seasons WHERE ended_at IS NULL").get()) {
    db.prepare("INSERT INTO vl_seasons VALUES (?,?,?,NULL)").run(
      randomUUID(),
      "Founders season",
      initial,
    );
  }
  const started = Number(
    db.prepare("SELECT value FROM vl_state WHERE key='started'").get().value,
  );
  function tx(fn) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  function seasonAt(at) {
    return db
      .prepare(
        "SELECT id FROM vl_seasons WHERE started_at<=? AND (ended_at IS NULL OR ended_at>?)",
      )
      .get(at, at)?.id;
  }
  function record(
    metric,
    subject,
    name,
    value,
    at,
    add = false,
    seasonValue = value,
  ) {
    if (!METRICS.includes(metric) || !Number.isFinite(value) || value < 0)
      fail("Invalid record");
    for (const scope of ["all", seasonAt(at)].filter(Boolean)) {
      const old = db
        .prepare(
          "SELECT value FROM vl_records WHERE scope=? AND metric=? AND subject=?",
        )
        .get(scope, metric, subject);
      const contribution = scope === "all" ? value : seasonValue;
      const next = add
        ? Number(old?.value || 0) + contribution
        : Math.max(Number(old?.value || 0), contribution);
      if (old && next === old.value) continue;
      db.prepare(
        "INSERT INTO vl_records VALUES (?,?,?,?,?,?) ON CONFLICT(scope,metric,subject) DO UPDATE SET value=excluded.value,name=excluded.name,achieved_at=excluded.achieved_at",
      ).run(scope, metric, subject, text(name) || "Survivor", next, at);
    }
  }
  function life(id) {
    return db.prepare("SELECT * FROM vl_lives WHERE id=?").get(id);
  }
  function current(id) {
    return db
      .prepare("SELECT * FROM vl_lives WHERE steam_id=? AND ended_at IS NULL")
      .get(id);
  }
  function expire() {
    db.prepare(
      "UPDATE vl_nests SET status='closed' WHERE status='open' AND expires_at<=?",
    ).run(now());
  }
  function snapshot(players, sampledAt) {
    const at =
      typeof sampledAt === "number" ? sampledAt : Date.parse(sampledAt);
    if (!Number.isFinite(at) || at > now() + 120000 || at < started)
      return { skipped: true };
    return tx(() => {
      const previous = Number(
        db.prepare("SELECT value FROM vl_state WHERE key='snapshot'").get()
          ?.value || 0,
      );
      if (at <= previous) return { duplicate: true };
      const seen = new Set();
      for (const p of players) {
        if (!/^\d{17}$/.test(String(p.steamId)) || seen.has(p.steamId))
          continue;
        seen.add(p.steamId);
        const sp = species(p.species);
        if (!sp) continue;
        const name = text(p.name) || "Survivor";
        const rawGrowth = p.growth == null ? null : Number(p.growth);
        const growth = Number.isFinite(rawGrowth)
          ? rawGrowth > 1.5
            ? rawGrowth / 100
            : rawGrowth
          : null;
        const loc =
          p.location &&
          [p.location.x, p.location.y].every(
            (v) => v != null && Number.isFinite(Number(v)),
          )
            ? { x: Number(p.location.x), y: Number(p.location.y) }
            : null;
        let old = current(p.steamId);
        if (old && at <= old.last_at) continue;
        // No claim of a continuous life across unobserved gaps or species/growth resets.
        if (
          old &&
          (old.species !== sp ||
            at - old.last_at > 900000 ||
            (growth != null &&
              old.growth != null &&
              growth < old.growth - 0.05))
        ) {
          db.prepare("UPDATE vl_lives SET ended_at=last_at WHERE id=?").run(
            old.id,
          );
          old = null;
        }
        const id = old?.id || randomUUID();
        if (!old)
          db.prepare(
            "INSERT INTO vl_lives(id,steam_id,name,species,started_at,last_at,growth,location,mutations) VALUES (?,?,?,?,?,?,?,?,?)",
          ).run(
            id,
            p.steamId,
            name,
            sp,
            at,
            at,
            growth,
            JSON.stringify(loc),
            JSON.stringify(
              Array.isArray(p.mutations) ? p.mutations.slice(0, 32) : [],
            ),
          );
        else {
          const seconds = Math.floor((at - old.last_at) / 1000);
          const activeStart =
            db
              .prepare("SELECT started_at FROM vl_seasons WHERE id=?")
              .get(seasonAt(at))?.started_at || at;
          const seasonSeconds = Math.max(
            0,
            Math.floor((at - Math.max(old.last_at, activeStart)) / 1000),
          );
          db.prepare(
            "INSERT INTO vl_mastery VALUES (?,?,?) ON CONFLICT(steam_id,species) DO UPDATE SET seconds=seconds+excluded.seconds",
          ).run(p.steamId, sp, seconds);
          record(
            "survival_seconds",
            id,
            name,
            seconds,
            at,
            true,
            seasonSeconds,
          );
          if (["rex", "tyrannosaurus", "tyrannosaurusrex"].includes(sp))
            record("rex_seconds", id, name, seconds, at, true, seasonSeconds);
          const prior = JSON.parse(old.location || "null");
          if (loc && prior) {
            const metres = Math.hypot(loc.x - prior.x, loc.y - prior.y) / 100;
            if (seconds > 0 && metres / seconds <= 40)
              record(
                "journey_metres",
                id,
                name,
                metres,
                at,
                true,
                old.last_at >= activeStart ? metres : 0,
              );
          }
          db.prepare(
            "UPDATE vl_lives SET name=?,last_at=?,growth=?,location=?,mutations=? WHERE id=?",
          ).run(
            name,
            at,
            growth,
            JSON.stringify(loc),
            JSON.stringify(
              Array.isArray(p.mutations) ? p.mutations.slice(0, 32) : [],
            ),
            id,
          );
        }
      }
      // A complete successful snapshot that omits a player ends observed continuity.
      for (const row of db
        .prepare(
          "SELECT id,steam_id,last_at FROM vl_lives WHERE ended_at IS NULL",
        )
        .all()) {
        if (!seen.has(row.steam_id))
          db.prepare("UPDATE vl_lives SET ended_at=? WHERE id=?").run(
            row.last_at,
            row.id,
          );
      }
      db.prepare(
        "INSERT INTO vl_state VALUES ('snapshot',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ).run(String(at));
      expire();
      return { accepted: true };
    });
  }
  function ingest(event) {
    const e = {
      id: text(event.id, 160),
      type: text(event.type),
      steamId: steam(event.steamId),
      at: Number(event.at),
      value: Number(event.value ?? 1),
      name: text(event.name) || "Survivor",
    };
    if (
      !e.id ||
      !Number.isFinite(e.at) ||
      e.at > now() + 120000 ||
      e.at < started ||
      !Number.isSafeInteger(e.value) ||
      e.value < 1 ||
      e.value > 100000000
    )
      fail("Invalid event");
    if (
      ![
        "combat_kill",
        "combat_death",
        "gameplay_coins",
        "territory_capture",
        "group_battle",
      ].includes(e.type)
    )
      fail("Unknown event type");
    const payload = JSON.stringify(e);
    return tx(() => {
      const prior = db
        .prepare("SELECT payload FROM vl_events WHERE id=?")
        .get(e.id);
      if (prior) {
        if (prior.payload !== payload)
          fail("Event ID conflicts with existing evidence", 409);
        return { duplicate: true };
      }
      // Closed seasons are immutable. Delayed evidence requires explicit reconciliation.
      if (seasonAt(e.at) !== seasonAt(now()))
        fail("Event belongs to a closed season", 409);
      db.prepare("INSERT INTO vl_events VALUES (?,?,?)").run(
        e.id,
        payload,
        e.at,
      );
      if (e.type === "combat_death") {
        const row = current(e.steamId);
        if (row && row.started_at <= e.at)
          db.prepare("UPDATE vl_lives SET ended_at=? WHERE id=?").run(
            e.at,
            row.id,
          );
      }
      if (e.type.startsWith("combat_")) {
        // Recompute in event-time order so delayed deaths cannot inflate streaks.
        const events = db
          .prepare(
            "SELECT payload FROM vl_events WHERE json_extract(payload,'$.steamId')=? AND json_extract(payload,'$.type') IN ('combat_kill','combat_death') ORDER BY occurred_at,id",
          )
          .all(e.steamId)
          .map((r) => JSON.parse(r.payload));
        for (const scope of ["all", seasonAt(now())]) {
          let streak = 0,
            best = 0;
          for (const item of events) {
            if (scope !== "all" && seasonAt(item.at) !== scope) continue;
            streak = item.type === "combat_death" ? 0 : streak + 1;
            best = Math.max(best, streak);
          }
          db.prepare(
            "INSERT INTO vl_records VALUES (?,?,?,?,?,?) ON CONFLICT(scope,metric,subject) DO UPDATE SET value=excluded.value,name=excluded.name,achieved_at=excluded.achieved_at",
          ).run(scope, "kill_streak", e.steamId, e.name, best, e.at);
        }
      } else
        record(
          {
            gameplay_coins: "gameplay_coins",
            territory_capture: "territory_captures",
            group_battle: "group_battle",
          }[e.type],
          e.steamId,
          e.name,
          e.value,
          e.at,
          e.type !== "group_battle",
        );
      return { accepted: true };
    });
  }
  function rotate(name) {
    return tx(() => {
      const at = now();
      const active = db
        .prepare("SELECT * FROM vl_seasons WHERE ended_at IS NULL")
        .get();
      if (at <= active.started_at) fail("Season must have a positive duration");
      db.prepare("UPDATE vl_seasons SET ended_at=? WHERE id=?").run(
        at,
        active.id,
      );
      const id = randomUUID();
      db.prepare("INSERT INTO vl_seasons VALUES (?,?,?,NULL)").run(
        id,
        text(name) || "New season",
        at,
      );
      return { id };
    });
  }
  function overview() {
    expire();
    const seasons = db
      .prepare("SELECT * FROM vl_seasons ORDER BY started_at DESC")
      .all();
    const rankings = {};
    for (const scope of ["all", seasons[0].id])
      rankings[scope] = METRICS.map((metric) => ({
        metric,
        leaders: db
          .prepare(
            "SELECT name,value,achieved_at FROM vl_records WHERE scope=? AND metric=? AND value>0 ORDER BY value DESC,achieved_at,subject LIMIT 10",
          )
          .all(scope, metric),
      }));
    const hallOfFame = seasons
      .filter((s) => s.ended_at)
      .map((s) => ({
        ...s,
        winners: METRICS.map((metric) => ({
          metric,
          ...db
            .prepare(
              "SELECT name,value FROM vl_records WHERE scope=? AND metric=? AND value>0 ORDER BY value DESC,achieved_at,subject LIMIT 1",
            )
            .get(s.id, metric),
        })),
      }));
    return {
      seasons,
      rankings,
      hallOfFame,
      trackingSince: started,
      nests: db
        .prepare(
          "SELECT id,name,species,eggs,remaining,expires_at FROM vl_nests WHERE status='open' ORDER BY created_at DESC LIMIT 100",
        )
        .all(),
      producers: {
        combat: "durable feed reconciliation",
        gameplayCoins: "playtime and event reward ledger",
        territoryCaptures: "pending",
        groupBattles: "pending",
        hatches: "admin-verified evidence required",
      },
    };
  }
  function mine(player) {
    const id = steam(player);
    expire();
    const lives = db
      .prepare(
        "SELECT id,name,species,started_at,last_at,ended_at,mutations,generation FROM vl_lives WHERE steam_id=? ORDER BY started_at DESC LIMIT 100",
      )
      .all(id)
      .map((row) => ({
        ...row,
        parents: db
          .prepare(
            "SELECT l.id,l.name,l.species FROM vl_parents p JOIN vl_lives l ON l.id=p.parent WHERE p.child=?",
          )
          .all(row.id),
        offspring: db
          .prepare(
            "SELECT l.id,l.name,l.species FROM vl_parents p JOIN vl_lives l ON l.id=p.child WHERE p.parent=?",
          )
          .all(row.id),
      }));
    const mastery = db
      .prepare(
        "SELECT species,seconds FROM vl_mastery WHERE steam_id=? ORDER BY seconds DESC",
      )
      .all(id)
      .map((r) => {
        const xp = Math.floor(r.seconds / 300) * 10;
        const level = Math.min(50, 1 + Math.floor(Math.sqrt(xp / 100)));
        return {
          ...r,
          xp,
          level,
          unlocks: UNLOCKS.filter((n) => level >= n).map((n) => ({
            level: n,
            title: `${r.species} ${n === 50 ? "Legend" : n >= 25 ? "Veteran" : "Explorer"} ${n}`,
          })),
        };
      });
    const nests = db
      .prepare(
        "SELECT * FROM vl_nests WHERE host=? ORDER BY created_at DESC LIMIT 100",
      )
      .all(id)
      .map((n) => ({
        ...n,
        requests: db
          .prepare("SELECT id,name,status FROM vl_requests WHERE nest=?")
          .all(n.id),
      }));
    return {
      lives,
      mastery,
      nests,
      requests: db
        .prepare(
          "SELECT r.id,r.nest,r.status,n.name,n.species FROM vl_requests r JOIN vl_nests n ON n.id=r.nest WHERE r.player=? ORDER BY r.created_at DESC LIMIT 100",
        )
        .all(id),
    };
  }
  function createNest(player, input) {
    const host = steam(player);
    const parent = life(text(input.parent, 80));
    const eggs = Number(input.eggs);
    if (
      !parent ||
      parent.steam_id !== host ||
      parent.ended_at ||
      now() - parent.last_at > 900000
    )
      fail("Choose your currently observed dinosaur");
    if (!Number.isInteger(eggs) || eggs < 1 || eggs > 12)
      fail("Egg count must be 1–12");
    return tx(() => {
      expire();
      if (
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM vl_nests WHERE host=? AND status='open'",
          )
          .get(host).n >= 3
      )
        fail("Close an existing nest first", 409);
      const id = randomUUID();
      db.prepare("INSERT INTO vl_nests VALUES (?,?,?,?,?,?,?,'open',?,?)").run(
        id,
        host,
        parent.id,
        parent.species,
        text(input.name) || `${parent.species} nest`,
        eggs,
        eggs,
        now(),
        now() + 86400000,
      );
      return { id };
    });
  }
  function requestEgg(player, name, nestId) {
    const id = steam(player);
    return tx(() => {
      expire();
      const nest = db.prepare("SELECT * FROM vl_nests WHERE id=?").get(nestId);
      if (!nest || nest.status !== "open" || nest.remaining < 1)
        fail("Nest is no longer available", 409);
      if (nest.host === id) fail("You cannot request your own egg");
      const existing = db
        .prepare("SELECT id FROM vl_requests WHERE nest=? AND player=?")
        .get(nestId, id);
      if (existing) return existing;
      const requestId = randomUUID();
      db.prepare("INSERT INTO vl_requests VALUES (?,?,?, ?,'pending',?)").run(
        requestId,
        nestId,
        id,
        text(name) || "Survivor",
        now(),
      );
      return { id: requestId };
    });
  }
  function manageNest(player, nestId, input) {
    return tx(() => {
      expire();
      const n = db.prepare("SELECT * FROM vl_nests WHERE id=?").get(nestId);
      if (!n || n.host !== steam(player)) fail("Nest not found", 404);
      if (input.action === "close") {
        db.prepare("UPDATE vl_nests SET status='closed' WHERE id=?").run(
          nestId,
        );
        return { ok: true };
      }
      if (!["accept", "reject"].includes(input.action))
        fail("Unknown nest action");
      const r = db
        .prepare("SELECT * FROM vl_requests WHERE id=? AND nest=?")
        .get(input.requestId, nestId);
      if (!r) fail("Request not found", 404);
      if (r.status !== "pending") return { ok: true };
      if (input.action === "accept") {
        if (n.status !== "open" || n.remaining < 1) fail("No eggs remain", 409);
        db.prepare(
          "UPDATE vl_nests SET remaining=remaining-1,status=CASE WHEN remaining=1 THEN 'closed' ELSE status END WHERE id=?",
        ).run(nestId);
      }
      db.prepare("UPDATE vl_requests SET status=? WHERE id=?").run(
        input.action === "accept" ? "accepted" : "rejected",
        r.id,
      );
      return { ok: true };
    });
  }
  function hatch(input) {
    const child = life(input.child);
    const parents = [...new Set(input.parents || [])].map(life);
    if (
      !child ||
      parents.length < 1 ||
      parents.length > 2 ||
      parents.some(
        (p) =>
          !p ||
          p.id === child.id ||
          p.species !== child.species ||
          p.started_at >= child.started_at,
      )
    )
      fail("Parents must be earlier dinosaurs of the same species");
    if (!text(input.evidence, 300))
      fail("Hatch evidence reference is required");
    return tx(() => {
      const existing = db
        .prepare("SELECT parent FROM vl_parents WHERE child=?")
        .all(child.id)
        .map((r) => r.parent)
        .sort();
      const requested = parents.map((p) => p.id).sort();
      if (existing.length) {
        if (JSON.stringify(existing) !== JSON.stringify(requested))
          fail("Lineage is immutable", 409);
        return { duplicate: true };
      }
      // Do not retroactively change descendants when verifying an old generation.
      if (
        db.prepare("SELECT child FROM vl_parents WHERE parent=?").get(child.id)
      )
        fail("Verify ancestors before their descendants", 409);
      for (const p of parents) {
        db.prepare("INSERT INTO vl_parents VALUES (?,?)").run(child.id, p.id);
        record("offspring", p.id, p.name, 1, now(), true);
      }
      db.prepare("UPDATE vl_lives SET generation=? WHERE id=?").run(
        1 + Math.max(...parents.map((p) => p.generation)),
        child.id,
      );
      db.prepare("INSERT INTO vl_events VALUES (?,?,?)").run(
        `hatch:${child.id}`,
        JSON.stringify({
          type: "hatch",
          child: child.id,
          parents: requested,
          evidence: text(input.evidence, 300),
        }),
        now(),
      );
      return { accepted: true };
    });
  }
  return {
    snapshot,
    ingest,
    rotate,
    overview,
    mine,
    createNest,
    requestEgg,
    manageNest,
    hatch,
    started,
    db,
  };
}
module.exports = { createLegacyStore, METRICS };
