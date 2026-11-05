"use strict";

// Evidence-only rotations. This module never reads or writes currency tables.
const DAY = 86400000;
const OFFSET = 10 * 3600000; // Australia/Brisbane has no daylight saving.
const {canonicalCombatSpecies}=require('../config/combatSpecies');
const ALIASES=Object.freeze({rex:'tyrannosaurus',tyrannosaurusrex:'tyrannosaurus',diablo:'diabloceratops',dryo:'dryosaurus',tenonto:'tenontosaurus',maia:'maiasaura',pachy:'pachycephalosaurus',stego:'stegosaurus',trike:'triceratops',galli:'gallimimus',hypsi:'hypsilophodon',carno:'carnotaurus',cerato:'ceratosaurus',deino:'deinosuchus',dilo:'dilophosaurus',herrera:'herrerasaurus',ptera:'pteranodon',utahraptor:'omniraptor'});
const HERBIVORES = new Set(['diablo','diabloceratops','dryo','dryosaurus','tenonto','tenontosaurus','maia','maiasaura','pachy','pachycephalosaurus','stego','stegosaurus','trike','triceratops','galli','gallimimus','hypsi','hypsilophodon']);
const DEFINITIONS = Object.freeze({
  'survival-90': Object.freeze({id:'survival-90', title:'Hold Your Ground', metric:'observed_seconds', target:5400}),
  'herbivore-adult': Object.freeze({id:'herbivore-adult', title:'Grow a Herbivore', metric:'observed_adulthood', target:1}),
  'species-three': Object.freeze({id:'species-three', title:'Valley Variety', metric:'species', target:3}),
});
function periods(at) {
  const day = Math.floor((at + OFFSET) / DAY);
  const start = day * DAY - OFFSET;
  const weekDay = ((day + 3) % 7 + 7) % 7; // Monday, including pre-epoch dates.
  return [
    {cadence:'daily', start, end:start+DAY, definition:DEFINITIONS[day % 2 === 0 ? 'survival-90' : 'herbivore-adult']},
    {cadence:'weekly', start:start-weekDay*DAY, end:start+(7-weekDay)*DAY, definition:DEFINITIONS['species-three']},
  ];
}
function steam(value) {
  if (typeof value !== 'string' || !/^\d{17}$/.test(value)) throw new Error('Linked Steam identity required');
  return value;
}
function createDynamicChallengeStore(db, {now=Date.now, enabled=()=>process.env.DYNAMIC_CHALLENGES_ENABLED==='1'}={}) {
  db.exec(`CREATE TABLE IF NOT EXISTS dc_participants(steam_id TEXT PRIMARY KEY, joined_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS dc_cursor(steam_id TEXT PRIMARY KEY, life_id TEXT NOT NULL, species TEXT NOT NULL, at INTEGER NOT NULL, segment TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS dc_evidence(steam_id TEXT NOT NULL, cadence TEXT NOT NULL, period_start INTEGER NOT NULL,
      challenge_id TEXT NOT NULL, subject TEXT NOT NULL, amount INTEGER NOT NULL, juvenile INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(steam_id,cadence,period_start,challenge_id,subject));`);
  function transaction(fn) {
    db.exec('SAVEPOINT dynamic_challenges');
    try { const result=fn(); db.exec('RELEASE dynamic_challenges'); return result; }
    catch(error) { db.exec('ROLLBACK TO dynamic_challenges; RELEASE dynamic_challenges'); throw error; }
  }
  function participate(id, selected) {
    steam(id);
    if (!enabled()) throw Object.assign(new Error('Dynamic challenges are disabled'),{status:503});
    if (typeof selected !== 'boolean') throw new Error('Explicit participation choice required');
    return transaction(()=>{
      if(selected) db.prepare('INSERT OR IGNORE INTO dc_participants VALUES (?,?)').run(id,now());
      else {
        for(const table of ['dc_evidence','dc_cursor','dc_participants']) db.prepare(`DELETE FROM ${table} WHERE steam_id=?`).run(id);
      }
      return status(id);
    });
  }
  // Only call inside the accepted Legacy snapshot transaction. No positions,
  // names, private journey receipts or inferred event attendance are consumed.
  function observe(rows, at) {
    if (!enabled() || !Number.isSafeInteger(at) || at>now()+120000) return;
    for(const row of rows) {
      const species=canonicalCombatSpecies(ALIASES[row.species]||row.species);
      if(!species) continue;
      const joined=db.prepare('SELECT joined_at FROM dc_participants WHERE steam_id=?').get(row.steam_id);
      if(!joined || at<=joined.joined_at) continue;
      const old=db.prepare('SELECT * FROM dc_cursor WHERE steam_id=?').get(row.steam_id);
      if(old && at<=old.at) continue;
      const connected=old && old.life_id===row.id && old.species===row.species && at-old.at<=900000;
      const segment=connected?old.segment:`${row.id}:${at}`;
      for(const period of periods(at)) {
        const {definition:d}=period;
        const subject=d.id==='species-three'?species:segment;
        if(!subject) continue;
        const prior=db.prepare('SELECT amount,juvenile FROM dc_evidence WHERE steam_id=? AND cadence=? AND period_start=? AND challenge_id=? AND subject=?')
          .get(row.steam_id,period.cadence,period.start,d.id,subject);
        let amount=prior?.amount||0, juvenile=prior?.juvenile||0;
        if(d.id==='species-three') amount=1;
        else if(d.id==='survival-90' && connected) {
          // A boundary-crossing interval contributes only its portion in this period.
          amount+=Math.floor((at-Math.max(old.at,period.start,joined.joined_at))/1000);
        } else if(d.id==='herbivore-adult' && HERBIVORES.has(row.species) && typeof row.growth==='number' && row.growth>=0 && row.growth<=1) {
          if(row.growth<1) juvenile=1;
          else if(juvenile) amount=1;
        }
        db.prepare(`INSERT INTO dc_evidence VALUES (?,?,?,?,?,?,?) ON CONFLICT(steam_id,cadence,period_start,challenge_id,subject)
          DO UPDATE SET amount=excluded.amount,juvenile=excluded.juvenile`).run(row.steam_id,period.cadence,period.start,d.id,subject,Math.min(d.target,amount),juvenile);
      }
      db.prepare('INSERT INTO dc_cursor VALUES (?,?,?,?,?) ON CONFLICT(steam_id) DO UPDATE SET life_id=excluded.life_id,species=excluded.species,at=excluded.at,segment=excluded.segment')
        .run(row.steam_id,row.id,row.species,at,segment);
    }
    // Every accepted snapshot is complete. An absent or invalid observation
    // breaks challenge continuity even if Legacy cannot identify a new life.
    db.prepare('DELETE FROM dc_cursor WHERE at<>?').run(at);
    // Progress is private and short-lived; missed days never create a debt.
    db.prepare('DELETE FROM dc_evidence WHERE period_start<?').run(now()-35*DAY);
  }
  function status(id) {
    steam(id);
    if(!enabled()) return {enabled:false};
    const participating=Boolean(db.prepare('SELECT 1 FROM dc_participants WHERE steam_id=?').get(id));
    return {enabled:true,participating,timezone:'Australia/Brisbane',rewardsEnabled:false,challenges:periods(now()).map(p=>{
      const rows=db.prepare('SELECT amount FROM dc_evidence WHERE steam_id=? AND cadence=? AND period_start=? AND challenge_id=?')
        .all(id,p.cadence,p.start,p.definition.id);
      const amount=p.definition.id==='species-three'?rows.length:rows.reduce((best,r)=>Math.max(best,r.amount),0);
      return {...p.definition,cadence:p.cadence,startsAt:p.start,endsAt:p.end,progress:Math.min(p.definition.target,amount),completed:amount>=p.definition.target};
    })};
  }
  return {participate,observe,status};
}
module.exports={createDynamicChallengeStore,periods};
