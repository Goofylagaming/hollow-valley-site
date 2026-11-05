"use strict";

const { db } = require("../db");
const community = require("./subscriberCommunity");
const { migrate } = require("./membershipCollection");
const ballots = require("./membershipSkinVote");
const transitions = {submitted:["shortlisted","declined"],shortlisted:["voting","declined"],
  voting:["selected","declined"],selected:["planned","declined"],planned:["released","declined"]};
const themes = new Set(["marsh-exploration","migration-watch","forest-photography"]);

function schema() {
  community.schema();
  ballots.ensureSchema();
  migrate(db,new Date(Date.now()+36000000).toISOString().slice(0,7));
  db.exec(`CREATE TABLE IF NOT EXISTS membership_suggestion_reviews (
    suggestion_id INTEGER PRIMARY KEY REFERENCES subscriber_suggestions(id), stage TEXT NOT NULL,
    option_id INTEGER UNIQUE REFERENCES membership_skin_vote_options(id), moderator INTEGER NOT NULL REFERENCES users(id),
    theme TEXT, skin_id TEXT, public_credit INTEGER NOT NULL DEFAULT 0
  )`);
}

function fail(status,message) {const error=new Error(message);error.status=status;throw error;}
function review(actor,id,input) {
  if (!actor?.is_admin) fail(403,"Administrator required");
  schema();
  db.exec("BEGIN IMMEDIATE");
  try {
    const suggestion=db.prepare("SELECT * FROM subscriber_suggestions WHERE id=?").get(id);
    if(!suggestion) fail(404,"Suggestion unavailable");
    const existing=db.prepare("SELECT * FROM membership_suggestion_reviews WHERE suggestion_id=?").get(id);
    const from=existing?.stage || suggestion.status, stage=input.stage;
    if(!transitions[from]?.includes(stage)) fail(409,"Invalid review transition");
    const option=existing?.option_id || input.optionId || null;
    if(stage==="voting" && !db.prepare(`SELECT 1 FROM membership_skin_vote_options o JOIN membership_skin_vote_ballots b
      ON o.ballot_id=b.id WHERE o.id=? AND b.status='open' AND b.closes_at>?`).get(option,Date.now())) fail(409,"Open ballot option required");
    if(stage==="selected") {
      const counts=db.prepare(`SELECT o.id,count(v.user_id) AS votes FROM membership_skin_vote_options o
        JOIN membership_skin_vote_ballots b ON b.id=o.ballot_id LEFT JOIN membership_skin_votes v ON v.option_id=o.id
        WHERE b.status='closed' AND b.id=(SELECT ballot_id FROM membership_skin_vote_options WHERE id=?)
        GROUP BY o.id ORDER BY votes DESC`).all(option);
      if(!counts.length || counts[0].id!==option || !counts[0].votes || counts[0].votes===counts[1]?.votes) fail(409,"A unique winning option is required");
    }
    const theme=input.theme || existing?.theme || null;
    if(theme && !themes.has(theme)) fail(400,"Unsupported public theme");
    const skin=input.skinId || existing?.skin_id || null;
    if(skin && !/^[a-zA-Z0-9_-]{1,80}$/.test(skin)) fail(400,"Invalid skin reference");
    db.prepare(`INSERT INTO membership_suggestion_reviews(suggestion_id,stage,option_id,moderator,theme,skin_id)
      VALUES (?,?,?,?,?,?) ON CONFLICT(suggestion_id) DO UPDATE SET stage=excluded.stage,option_id=excluded.option_id,
      moderator=excluded.moderator,theme=excluded.theme,skin_id=excluded.skin_id`).run(id,stage,option,actor.id,theme,skin);
    if(stage==="released"){
      db.prepare("INSERT OR IGNORE INTO membership_collectibles(slug,name,kind) VALUES ('community-choice','Community Choice','badge')").run();
      db.prepare("INSERT OR IGNORE INTO membership_user_collectibles(user_id,slug) VALUES (?,'community-choice')").run(suggestion.user_id);
    }
    db.exec("COMMIT");return {stage,theme,skin};
  } catch(e){db.exec("ROLLBACK");throw e;}
}
module.exports={schema,review};
