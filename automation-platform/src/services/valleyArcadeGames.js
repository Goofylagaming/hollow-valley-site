"use strict";

const { randomInt, randomUUID, randomBytes, createHash } = require("node:crypto");
const arcade = require("./valleyArcade");
const { db, validateSteamId } = require("./economyStore");
const games = ["higher-lower","trivia","memory-match","daily-puzzle","reaction","guess-the-dino"];
const clues = [
  ["Which dinosaur carried three facial horns?", "Triceratops","Stegosaurus","Allosaurus"],
  ["Which dinosaur had plates along its back?", "Stegosaurus","Tyrannosaurus","Iguanodon"],
  ["Which dinosaur had a long neck?", "Diplodocus","Velociraptor","Triceratops"]
];
// Correct-answer Valley Coin payout. Shared by every game, including the three lobby additions.
const PAYOUT = 500;
const REACTION_COUNTDOWN_MS = 3000;
const REACTION_WINDOW_MS = 1500;
const REACTION_MIN_MS = 120;
const MEMORY_PAIRS = ["Egg","Egg","Claw","Claw","Fern","Fern"];

function shuffle(values) {
  const result = [...values];
  for (let i=result.length-1;i>0;i--) {
    const j=randomInt(i+1);
    [result[i],result[j]]=[result[j],result[i]];
  }
  return result;
}

function ensureSchema() {
  db.exec(`CREATE TABLE IF NOT EXISTS arcade_challenges (
    round_id TEXT PRIMARY KEY REFERENCES arcade_rounds(id), solution TEXT NOT NULL,
    opens INTEGER NOT NULL, closes INTEGER NOT NULL, go_token TEXT, board_json TEXT, flip_json TEXT)`);
  const cols = new Set(db.prepare("PRAGMA table_info(arcade_challenges)").all().map(column => column.name));
  if (!cols.has("go_token")) db.exec("ALTER TABLE arcade_challenges ADD COLUMN go_token TEXT");
  if (!cols.has("board_json")) db.exec("ALTER TABLE arcade_challenges ADD COLUMN board_json TEXT");
  if (!cols.has("flip_json")) db.exec("ALTER TABLE arcade_challenges ADD COLUMN flip_json TEXT");
  db.exec(`CREATE TABLE IF NOT EXISTS arcade_play_receipts (
    steam_id TEXT NOT NULL, request_key TEXT NOT NULL, game TEXT NOT NULL, response_json TEXT NOT NULL,
    PRIMARY KEY(steam_id,request_key))`);
}

function challenge(game, now) {
  if (game === "higher-lower") {
    const first = randomInt(1,11);
    let next = randomInt(1,10);
    if (next>=first) next++;
    return { prompt:"Dino track count is " + first + ". Will the next count be higher or lower?",
      choices:["Higher","Lower"], solution:next>first?"Higher":"Lower" };
  }
  if (game === "memory-match") {
    const board = shuffle(MEMORY_PAIRS);
    return { prompt:"Flip cards to find the three matching pairs.",
      choices:board.map((_,index)=>String(index+1)), cardCount:board.length,
      solution:randomBytes(16).toString("hex"), board, opens:now, closes:now+60000 };
  }
  if (game === "reaction") {
    const opens = now + REACTION_COUNTDOWN_MS + randomInt(400,2200);
    return { prompt:"Wait for GO, then tap as soon as you see it.", choices:["Tap"], solution:"Tap",
      opens, closes:opens+REACTION_WINDOW_MS };
  }
  if (game === "daily-puzzle") {
    const seed = createHash("sha256").update(arcade.dayKey(now)).digest().readUInt32BE();
    const start=seed%13+1, step=seed%7+2, solution=String(start+3*step);
    return {prompt:"Complete the track pattern: " + [start,start+step,start+2*step].join(", "),
      choices:shuffle([solution,String(Number(solution)+1),String(Number(solution)-1)]),solution};
  }
  if(game==="guess-the-dino"){
    const identities=[
      ["I have a sail on my back and a long snout. Who am I?","Spinosaurus","Carnotaurus","Stegosaurus"],
      ["My two brow horns and very short arms gave me a bull-like silhouette. Who am I?","Carnotaurus","Allosaurus","Ankylosaurus"],
      ["My tail ends in a heavy club. Who am I?","Ankylosaurus","Diplodocus","Parasaurolophus"]
    ];
    const [prompt,solution,...others]=identities[randomInt(identities.length)];
    return {prompt,choices:shuffle([solution,...others]),solution};
  }
  const [clue,solution,...others]=clues[randomInt(clues.length)];
  return {prompt:clue, choices:shuffle([solution,...others]),solution};
}

function publicRound(id, game, built, opens, closes) {
  const response = {id, game, prompt:built.prompt, choices:built.choices};
  if (built.cardCount) response.cardCount = built.cardCount;
  // The reaction go-time stays on the server. The client learns GO only from signal().
  if (game === "reaction") response.state = "wait";
  else { response.opens = opens; response.closes = closes; }
  return response;
}

function start(steamId, game, now=Date.now(), requestKey=null) {
  steamId=validateSteamId(steamId);
  if (process.env.VALLEY_ARCADE_ENABLED!=="1") throw new Error("Arcade disabled");
  const settings=arcade.settings();
  if (!settings.enabled || settings.emergency || !games.includes(game)) throw new Error("Game unavailable");
  const rewards=require('./arcadeRewards');
  if(rewards.enabled()) {
    rewards.schema();
    if(!/^[A-Za-z0-9_-]{8,100}$/.test(requestKey||'')) throw new Error('A play request key is required');
  }
  ensureSchema();
  db.exec("BEGIN IMMEDIATE");
  try {
    if(rewards.enabled()) {
      const prior=db.prepare('SELECT * FROM arcade_play_receipts WHERE steam_id=? AND request_key=?').get(steamId,requestKey);
      if(prior) {
        if(prior.game!==game)throw new Error('Play key conflicts with another game');
        db.exec('COMMIT');return JSON.parse(prior.response_json);
      }
      rewards.consumePlay(steamId,now);
    }
    if (db.prepare("SELECT 1 FROM arcade_rounds WHERE steam_id=? AND opened_at>? LIMIT 1").get(steamId,now-3000)) throw new Error("Wait before starting another round");
    const id=randomUUID();
    const built=challenge(game,now);
    const opens=built.opens??now, closes=built.closes??now+60000;
    db.prepare("INSERT INTO arcade_rounds(id,steam_id,game,opened_at) VALUES (?,?,?,?)").run(id,steamId,game,now);
    db.prepare(`INSERT INTO arcade_challenges(round_id,solution,opens,closes,board_json,flip_json)
      VALUES (?,?,?,?,?,?)`).run(id,built.solution,opens,closes,
      built.board?JSON.stringify(built.board):null,
      built.board?JSON.stringify({pending:null,matched:[]}):null);
    const response=publicRound(id,game,built,opens,closes);
    if(rewards.enabled()) db.prepare('INSERT INTO arcade_play_receipts VALUES (?,?,?,?)').run(steamId,requestKey,game,JSON.stringify(response));
    db.exec("COMMIT");
    return response;
  } catch (e) { db.exec("ROLLBACK"); throw e; }
}

function loadRound(steamId, id) {
  ensureSchema();
  return db.prepare(`SELECT c.round_id, c.solution, c.opens, c.closes, c.go_token, c.board_json, c.flip_json,
      r.game, r.opened_at, r.settled_day, r.score AS settled_score, r.payout AS settled_payout
    FROM arcade_challenges c JOIN arcade_rounds r ON r.id=c.round_id
    WHERE c.round_id=? AND r.steam_id=?`).get(id, steamId);
}

function answer(steamId, id, choice, now=Date.now(), token=null) {
  if (process.env.VALLEY_ARCADE_ENABLED!=="1") throw new Error("Arcade disabled");
  steamId=validateSteamId(steamId);
  const round=loadRound(steamId, id);
  if (!round) throw new Error("Unknown round");
  if (round.settled_day) return arcade.settle(steamId, id, round.settled_score||0, round.settled_payout||0, now);
  let correct=false;
  const extra={};
  if (round.game==="reaction") {
    const reactionMs=now-round.opens;
    const tokenOk=typeof token==="string" && token.length>=16 && token===round.go_token;
    const inWindow=now>=round.opens && now<=round.closes;
    correct=choice===round.solution && tokenOk && inWindow && reactionMs>=REACTION_MIN_MS;
    extra.tooFast=Boolean(tokenOk && inWindow && reactionMs<REACTION_MIN_MS);
    extra.early=now<round.opens;
    extra.tooSlow=now>round.closes;
    extra.reactionMs=tokenOk && now>=round.opens ? reactionMs : null;
  } else if (round.game==="memory-match") {
    const board=JSON.parse(round.board_json||"[]");
    const state=JSON.parse(round.flip_json||'{"matched":[]}');
    const matched=Array.isArray(state.matched)?state.matched.length:0;
    correct=board.length>0 && matched>=board.length && now>=round.opens && now<=round.closes;
  } else {
    correct=choice===round.solution && now>=round.opens && now<=round.closes;
  }
  return {...arcade.settle(steamId, id, correct?1:0, correct?PAYOUT:0, now), ...extra};
}

function signal(steamId, id, now=Date.now()) {
  if (process.env.VALLEY_ARCADE_ENABLED!=="1") throw new Error("Arcade disabled");
  steamId=validateSteamId(steamId);
  const round=loadRound(steamId, id);
  if (!round || round.game!=="reaction") throw new Error("Unknown round");
  if (round.settled_day || now>round.closes) return {state:"closed"};
  if (now<round.opens) {
    const elapsed=now-round.opened_at;
    if (elapsed<1000) return {state:"countdown", count:3};
    if (elapsed<2000) return {state:"countdown", count:2};
    if (elapsed<3000) return {state:"countdown", count:1};
    return {state:"wait"};
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    let token=db.prepare("SELECT go_token FROM arcade_challenges WHERE round_id=?").get(id).go_token;
    if (!token) {
      token=randomBytes(16).toString("hex");
      db.prepare("UPDATE arcade_challenges SET go_token=? WHERE round_id=? AND go_token IS NULL").run(token, id);
      token=db.prepare("SELECT go_token FROM arcade_challenges WHERE round_id=?").get(id).go_token;
    }
    db.exec("COMMIT");
    return {state:"go", token};
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

function saveFlip(id, state) {
  db.prepare("UPDATE arcade_challenges SET flip_json=? WHERE round_id=?").run(JSON.stringify(state), id);
}

function flip(steamId, id, position, now=Date.now()) {
  if (process.env.VALLEY_ARCADE_ENABLED!=="1") throw new Error("Arcade disabled");
  steamId=validateSteamId(steamId);
  const pos=Number(position);
  db.exec("BEGIN IMMEDIATE");
  let pendingSettle=null;
  let response=null;
  try {
    const round=loadRound(steamId, id);
    if (!round || round.game!=="memory-match" || !round.board_json) throw new Error("Unknown round");
    const board=JSON.parse(round.board_json);
    if (!Number.isInteger(pos) || pos<1 || pos>board.length) throw new Error("Unknown card");
    const state=JSON.parse(round.flip_json||'{"pending":null,"matched":[]}');
    state.matched=Array.isArray(state.matched)?state.matched:[];
    if (round.settled_day) {
      response={complete:round.settled_score>0, duplicate:true, score:round.settled_score, payout:round.settled_payout, matchedPositions:state.matched};
    } else if (now<round.opens || now>round.closes) {
      pendingSettle={score:0, payout:0, response:{expired:true, complete:false, matchedPositions:state.matched}};
    } else if (state.matched.length>=board.length) {
      pendingSettle={score:1, payout:PAYOUT, response:{complete:true, matchedPositions:state.matched}};
    } else if (state.matched.includes(pos) || state.pending===pos) {
      response={position:pos, symbol:board[pos-1], matched:state.matched.includes(pos), pending:state.pending===pos,
        matchedPositions:state.matched, complete:false};
    } else if (state.pending==null) {
      state.pending=pos;
      saveFlip(id, state);
      response={position:pos, symbol:board[pos-1], pending:true, matched:false, matchedPositions:state.matched, complete:false};
    } else {
      const first=state.pending;
      const matched=board[first-1]===board[pos-1];
      state.pending=null;
      if (matched) state.matched=[...state.matched, first, pos].sort((a,b)=>a-b);
      saveFlip(id, state);
      response={position:pos, symbol:board[pos-1], pair:{position:first, symbol:board[first-1]},
        matched, mismatch:!matched, matchedPositions:state.matched, complete:state.matched.length>=board.length};
      if (response.complete) pendingSettle={score:1, payout:PAYOUT, response};
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  if (!pendingSettle) return response;
  return {...pendingSettle.response, ...arcade.settle(steamId, id, pendingSettle.score, pendingSettle.payout, now)};
}

module.exports={games, start, answer, signal, flip, PAYOUT, REACTION_MIN_MS, REACTION_WINDOW_MS, REACTION_COUNTDOWN_MS};
