"use strict";

const { randomInt, randomUUID, createHash } = require("node:crypto");
const arcade = require("./valleyArcade");
const { db, validateSteamId } = require("./economyStore");
const games = ["higher-lower","trivia","memory-match","daily-puzzle","reaction","guess-the-dino"];
const clues = [
  ["Which dinosaur carried three facial horns?", "Triceratops","Stegosaurus","Allosaurus"],
  ["Which dinosaur had plates along its back?", "Stegosaurus","Tyrannosaurus","Iguanodon"],
  ["Which dinosaur had a long neck?", "Diplodocus","Velociraptor","Triceratops"]
];
function shuffle(values) {
  const result = [...values];
  for (let i=result.length-1;i>0;i--) {
    const j=randomInt(i+1);
    [result[i],result[j]]=[result[j],result[i]];
  }
  return result;
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
    const symbols=shuffle(["Egg","Egg","Claw","Claw","Fern","Fern"]);
    const target=symbols[randomInt(symbols.length)];
    const positions=symbols.flatMap((symbol,i)=>symbol===target?[i+1]:[]);
    const choices=symbols.map((_,i)=>String(i+1));
    return {preview:symbols.map((s,i)=>(i+1)+" "+s).join(" · "),hideAfterMs:3000,
      prompt:"Select both cards showing "+target+".",choices,solution:positions.join(","),opens:now+3000};
  }
  if (game === "reaction") {
    const opens = now + randomInt(1800,4500);
    return {prompt:"Tap when the signal turns green.",choices:["Tap"],solution:"Tap",opens,closes:opens+1500};
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

function start(steamId, game, now=Date.now()) {
  steamId=validateSteamId(steamId);
  if (process.env.VALLEY_ARCADE_ENABLED!=="1") throw new Error("Arcade disabled");
  const settings=arcade.settings();
  if (!settings.enabled || settings.emergency || !games.includes(game)) throw new Error("Game unavailable");
  db.exec(`CREATE TABLE IF NOT EXISTS arcade_challenges (
    round_id TEXT PRIMARY KEY REFERENCES arcade_rounds(id), solution TEXT NOT NULL, opens INTEGER NOT NULL, closes INTEGER NOT NULL)`);
  db.exec("BEGIN IMMEDIATE");
  try {
    if (db.prepare("SELECT 1 FROM arcade_rounds WHERE steam_id=? AND opened_at>? LIMIT 1").get(steamId,now-3000)) throw new Error("Wait before starting another round");
    const id=randomUUID();
    const {solution,opens=now,closes=now+60000,...display}=challenge(game,now);
    db.prepare("INSERT INTO arcade_rounds(id,steam_id,game,opened_at) VALUES (?,?,?,?)").run(id,steamId,game,now);
    db.prepare("INSERT INTO arcade_challenges VALUES (?,?,?,?)").run(id,solution,opens,closes);
    db.exec("COMMIT");
    return {id,game,opens,closes,...display};
  } catch (e) { db.exec("ROLLBACK"); throw e; }
}

function answer(steamId,id,choice,now=Date.now()) {
  if (process.env.VALLEY_ARCADE_ENABLED!=="1") throw new Error("Arcade disabled");
  const round=db.prepare(`SELECT c.* FROM arcade_challenges c JOIN arcade_rounds r ON r.id=c.round_id
    WHERE c.round_id=? AND r.steam_id=?`).get(id,validateSteamId(steamId));
  if (!round) throw new Error("Unknown round");
  const correct=choice===round.solution && now>=round.opens && now<=round.closes;
  return arcade.settle(steamId,id,correct?1:0,correct?500:0,now);
}
module.exports={games,start,answer};
