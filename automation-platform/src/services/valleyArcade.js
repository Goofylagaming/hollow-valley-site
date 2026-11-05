"use strict";

const { randomUUID } = require("node:crypto");
const economy = require("./economyStore");
const db = economy.db;
const dayKey = now => new Date(now + 36000000).toISOString().slice(0,10);

function schema() {
  db.exec(`CREATE TABLE IF NOT EXISTS arcade_settings (
    id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 0,
    emergency INTEGER NOT NULL DEFAULT 0, cap INTEGER DEFAULT 250000 CHECK(cap IS NULL OR cap>=0)
  );
  INSERT OR IGNORE INTO arcade_settings(id) VALUES (1);
  CREATE TABLE IF NOT EXISTS arcade_rounds (
    id TEXT PRIMARY KEY, steam_id TEXT NOT NULL, game TEXT NOT NULL, opened_at INTEGER NOT NULL,
    settled_day TEXT, score INTEGER, payout INTEGER
  );
  CREATE INDEX IF NOT EXISTS arcade_player_day ON arcade_rounds(steam_id,settled_day);
  CREATE TABLE IF NOT EXISTS arcade_settings_audit (
    id INTEGER PRIMARY KEY, actor TEXT NOT NULL, settings TEXT NOT NULL, changed_at INTEGER NOT NULL
  );`);
}

function settings() {
  schema();
  return { ...db.prepare("SELECT enabled,emergency,cap FROM arcade_settings WHERE id=1").get(), wageringEnabled:false };
}

function configure(actor, { enabled, emergency, cap }) {
  if (!actor || typeof enabled !== "boolean" || typeof emergency !== "boolean" ||
      (cap !== null && (!Number.isSafeInteger(cap) || cap < 0))) throw new Error("Invalid arcade settings");
  schema();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE arcade_settings SET enabled=?,emergency=?,cap=? WHERE id=1").run(+enabled,+emergency,cap);
    db.prepare("INSERT INTO arcade_settings_audit(actor,settings,changed_at) VALUES (?,?,?)")
      .run(String(actor),JSON.stringify({enabled,emergency,cap}),Date.now());
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return settings();
}

// Only a trusted server game resolver may supply the score and requested prize.
function settle(steamId, roundId, score, requested, now = Date.now()) {
  steamId = economy.validateSteamId(steamId);
  if (process.env.VALLEY_ARCADE_ENABLED !== "1") throw new Error("Arcade disabled");
  if (!Number.isSafeInteger(requested) || requested<0 || !Number.isSafeInteger(score) || score<0) throw new Error("Invalid outcome");
  schema();
  db.exec("BEGIN IMMEDIATE");
  try {
    const config = db.prepare("SELECT * FROM arcade_settings WHERE id=1").get();
    if (!config.enabled || config.emergency) throw new Error("Arcade disabled");
    const round = db.prepare("SELECT * FROM arcade_rounds WHERE id=? AND steam_id=?").get(roundId,steamId);
    if (!round) throw new Error("Unknown round");
    if (round.settled_day) {
      db.exec("COMMIT");
      return {score:round.score,payout:round.payout,duplicate:true};
    }
    const day = dayKey(now);
    const earned = db.prepare("SELECT coalesce(sum(payout),0) AS total FROM arcade_rounds WHERE steam_id=? AND settled_day=?").get(steamId,day).total;
    const payout = config.cap === null ? requested : Math.min(requested,Math.max(0,config.cap-earned));
    if (payout) {
      const wallet = economy.ensureWallet(steamId);
      if (!Number.isSafeInteger(wallet.balance+payout)) throw new Error("Balance limit exceeded");
      db.prepare("UPDATE economy_wallets SET balance=balance+?,updated_at=CURRENT_TIMESTAMP WHERE steam_id=?").run(payout,steamId);
      db.prepare(`INSERT INTO economy_wallet_ledger(id,steam_id,amount,kind,reason,idempotency_key,reference_type,reference_id)
        VALUES (?,?,?,'arcade_reward','Valley Arcade reward',?,'arcade_round',?)`).run(randomUUID(),steamId,payout,"arcade:"+roundId,roundId);
    }
    db.prepare("UPDATE arcade_rounds SET settled_day=?,score=?,payout=? WHERE id=?").run(day,score,payout,roundId);
    db.exec("COMMIT");
    return {score,payout,duplicate:false};
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
module.exports = { settings, configure, settle, dayKey };
