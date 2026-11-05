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
  if (typeof value !== 'string' || !/^\d{17}$/.test(value)) fail('Linked Steam identity required');
  return value;
}
function fail(message,status=400) {throw Object.assign(new Error(message),{status});}
function createDynamicChallengeStore(db, {now=Date.now, enabled=()=>process.env.DYNAMIC_CHALLENGES_ENABLED==='1'}={}) {
  const attendance=require('./challengeAttendanceEvidence').createChallengeAttendanceEvidence(db,{now});
  db.exec(`CREATE TABLE IF NOT EXISTS dc_participants(steam_id TEXT PRIMARY KEY, joined_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS dc_cursor(steam_id TEXT PRIMARY KEY, life_id TEXT NOT NULL, species TEXT NOT NULL, at INTEGER NOT NULL, segment TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS dc_evidence(steam_id TEXT NOT NULL, cadence TEXT NOT NULL, period_start INTEGER NOT NULL,
      challenge_id TEXT NOT NULL, subject TEXT NOT NULL, amount INTEGER NOT NULL, juvenile INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(steam_id,cadence,period_start,challenge_id,subject));
    CREATE TABLE IF NOT EXISTS dc_settings(steam_id TEXT PRIMARY KEY, revision INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS dc_requests(steam_id TEXT NOT NULL, request_key TEXT NOT NULL, expected_revision INTEGER NOT NULL,
      selected INTEGER NOT NULL, revision INTEGER NOT NULL, accepted_at INTEGER NOT NULL, PRIMARY KEY(steam_id,request_key));
    CREATE TABLE IF NOT EXISTS dc_runtime(id INTEGER PRIMARY KEY CHECK(id=1),active INTEGER NOT NULL,resumed_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS dc_observations(steam_id TEXT NOT NULL,segment TEXT NOT NULL,at INTEGER NOT NULL,species TEXT NOT NULL,growth REAL,
      PRIMARY KEY(steam_id,segment,at));
    CREATE INDEX IF NOT EXISTS dc_requests_recent ON dc_requests(steam_id,accepted_at);
    CREATE INDEX IF NOT EXISTS dc_evidence_retention ON dc_evidence(period_start);
    CREATE INDEX IF NOT EXISTS dc_cursor_age ON dc_cursor(at);
    CREATE INDEX IF NOT EXISTS dc_observation_retention ON dc_observations(at);`);
  const locations=require('./challengeLocationStore').createChallengeLocationStore(db,{now,enabled:()=>enabled()&&process.env.DYNAMIC_CHALLENGES_LOCATION_ENABLED==='1'});
  function transaction(fn,write=false) {
    db.exec(write?'BEGIN IMMEDIATE':'SAVEPOINT dynamic_challenges');
    try { const result=fn(); db.exec(write?'COMMIT':'RELEASE dynamic_challenges'); return result; }
    catch(error) { db.exec(write?'ROLLBACK':'ROLLBACK TO dynamic_challenges; RELEASE dynamic_challenges'); throw error; }
  }
  function synchronizeTracking() {
    const active=Number(Boolean(enabled()));
    const old=db.prepare('SELECT active FROM dc_runtime WHERE id=1').get();
    if(!old || old.active!==active || !active) {
      db.prepare('DELETE FROM dc_cursor').run();
      db.prepare('INSERT INTO dc_runtime VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET active=excluded.active,resumed_at=excluded.resumed_at').run(active,now());
    }
    return Boolean(active);
  }
  function prune() {
    // Also runs when snapshots stop or tracking is disabled. Consent and replay
    // receipts are retained; only private gameplay evidence expires here.
    return transaction(()=>{
      synchronizeTracking();
      locations.prune();
      const evidence=db.prepare('DELETE FROM dc_evidence WHERE period_start<?').run(now()-35*DAY).changes;
      const cursors=db.prepare('DELETE FROM dc_cursor WHERE at<?').run(now()-900000).changes;
      const observations=db.prepare('DELETE FROM dc_observations WHERE at<?').run(now()-35*DAY).changes;
      return {evidence:Number(evidence),cursors:Number(cursors),observations:Number(observations)};
    });
  }
  // Starting with tracking disabled must durably break continuity even if no
  // snapshot arrives before a later restart enables the feature again.
  prune();
  function change(id, {selected,expectedRevision,requestKey}={}) {
    steam(id);
    if (!enabled() && selected!==false) fail('Dynamic challenges are disabled',503);
    if (typeof selected !== 'boolean') fail('Explicit participation choice required');
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0) fail('Invalid participation revision');
    if(typeof requestKey!=='string'||!/^[-a-zA-Z0-9_]{16,80}$/.test(requestKey)) fail('Invalid participation request key');
    return transaction(()=>{
      const previous=db.prepare('SELECT * FROM dc_requests WHERE steam_id=? AND request_key=?').get(id,requestKey);
      if(previous) {
        if(previous.expected_revision!==expectedRevision || previous.selected!==Number(selected)) fail('Request key already used for a different choice',409);
        return {...status(id),duplicate:true};
      }
      const revision=db.prepare('SELECT revision FROM dc_settings WHERE steam_id=?').get(id)?.revision||0;
      if(revision!==expectedRevision) fail('Participation changed. Refresh before making another choice.',409);
      if(revision>=Number.MAX_SAFE_INTEGER) fail('Participation revision limit reached',409);
      const participating=Boolean(db.prepare('SELECT 1 FROM dc_participants WHERE steam_id=?').get(id));
      const at=now();
      // Always allow an actual opt-out; repeated no-op requests are rate limited.
      if((selected||!participating) && db.prepare('SELECT count(*) n FROM dc_requests WHERE steam_id=? AND accepted_at>?').get(id,at-60000).n>=20)
        fail('Too many participation changes. Try again shortly.',429);
      if(selected) db.prepare('INSERT OR IGNORE INTO dc_participants VALUES (?,?)').run(id,now());
      else {
        locations.erase(id);
        for(const table of ['dc_evidence','dc_cursor','dc_observations','dc_participants']) db.prepare(`DELETE FROM ${table} WHERE steam_id=?`).run(id);
      }
      db.prepare('INSERT INTO dc_settings VALUES (?,?) ON CONFLICT(steam_id) DO UPDATE SET revision=excluded.revision').run(id,revision+1);
      db.prepare('INSERT INTO dc_requests VALUES (?,?,?,?,?,?)').run(id,requestKey,expectedRevision,Number(selected),revision+1,at);
      return {...status(id),duplicate:false};
    },true);
  }
  // Only call inside the accepted Legacy snapshot transaction. No positions,
  // names, private journey receipts or inferred event attendance are consumed.
  function observe(rows, at) {
    if (!synchronizeTracking()) {locations.prune();return;}
    if (!Number.isSafeInteger(at) || at>now()+120000) return;
    // Delayed samples from a disabled interval cannot backfill after re-enable.
    if(at<db.prepare('SELECT resumed_at FROM dc_runtime WHERE id=1').get().resumed_at) return;
    for(const row of rows) {
      const species=canonicalCombatSpecies(ALIASES[row.species]||row.species);
      if(!species) continue;
      const joined=db.prepare('SELECT joined_at FROM dc_participants WHERE steam_id=?').get(row.steam_id);
      if(!joined || at<=joined.joined_at) continue;
      locations.observe({steamId:row.steam_id,lifeId:row.id,at,location:row.location});
      const old=db.prepare('SELECT * FROM dc_cursor WHERE steam_id=?').get(row.steam_id);
      if(old && at<=old.at) continue;
      const connected=old && old.life_id===row.id && old.species===row.species && at-old.at<=900000 &&
        db.prepare('SELECT 1 FROM dc_observations WHERE steam_id=? AND segment=? AND at=?').get(row.steam_id,old.segment,old.at) &&
        !deaths(row.steam_id,old.at,at).length;
      const segment=connected?old.segment:`${row.id}:${at}`;
      db.prepare('INSERT INTO dc_observations VALUES (?,?,?,?,?)').run(row.steam_id,segment,at,species,row.growth);
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
    locations.finishSnapshot(at);
    // Progress is private and short-lived; missed days never create a debt.
    db.prepare('DELETE FROM dc_evidence WHERE period_start<?').run(now()-35*DAY);
    db.prepare('DELETE FROM dc_observations WHERE at<?').run(now()-35*DAY);
  }
  function deaths(id,from,to) {
    return db.prepare(`SELECT occurred_at AS at FROM vl_events WHERE json_extract(payload,'$.steamId')=?
      AND json_extract(payload,'$.type')='combat_death' AND occurred_at>=? AND occurred_at<=? ORDER BY occurred_at,id`).all(id,from,to);
  }
  // Called after trusted Legacy event insertion, in that same transaction.
  // A death splits observation continuity; it does not invent a game-life link.
  function reconcileDeath(event) {
    const id=steam(event.steamId),at=event.at;
    if(!Number.isFinite(at)||!db.prepare('SELECT 1 FROM dc_participants WHERE steam_id=? AND joined_at<=?').get(id,at))return;
    locations.reconcileDeath(event);
    const segments=db.prepare(`SELECT segment,MIN(at) AS first_at,MAX(at) AS last_at FROM dc_observations
      WHERE steam_id=? GROUP BY segment HAVING MIN(at)<=? AND MAX(at)>=?`).all(id,at,at);
    for(const segment of segments) {
      const samples=db.prepare('SELECT at,species,growth FROM dc_observations WHERE steam_id=? AND segment=? ORDER BY at').all(id,segment.segment);
      const boundaries=deaths(id,segment.first_at,segment.last_at).map(row=>row.at);
      const totals=new Map();let previous=null;
      for(const sample of samples) {
        if(boundaries.includes(sample.at)){previous=null;continue;}
        const connected=previous && sample.at-previous.at<=900000 && !boundaries.some(time=>time>=previous.at&&time<=sample.at);
        for(const period of periods(sample.at).filter(p=>p.cadence==='daily')) {
          const d=period.definition,key=period.start+':'+d.id;
          const state=totals.get(key)||{period,amount:0,run:0,juvenile:0};
          if(!connected){state.run=0;state.juvenile=0;}
          if(d.id==='survival-90' && connected) {
            state.run+=Math.floor((sample.at-Math.max(previous.at,period.start))/1000);
            state.amount=Math.max(state.amount,Math.min(d.target,state.run));
          } else if(d.id==='herbivore-adult' && HERBIVORES.has(sample.species) && typeof sample.growth==='number' && sample.growth>=0 && sample.growth<=1) {
            if(sample.growth<1)state.juvenile=1;
            else if(state.juvenile)state.amount=1;
          }
          totals.set(key,state);
        }
        previous=sample;
      }
      db.prepare("DELETE FROM dc_evidence WHERE steam_id=? AND subject=? AND challenge_id IN ('survival-90','herbivore-adult')").run(id,segment.segment);
      for(const state of totals.values()) {
        if(state.period.start<now()-35*DAY)continue;
        db.prepare('INSERT INTO dc_evidence VALUES (?,?,?,?,?,?,?)').run(id,'daily',state.period.start,state.period.definition.id,segment.segment,state.amount,state.juvenile);
      }
      // Future observations start a fresh segment even when Legacy cannot
      // associate the delayed death with its currently observed life identity.
      db.prepare('DELETE FROM dc_cursor WHERE steam_id=? AND segment=?').run(id,segment.segment);
    }
  }
  function status(id) {
    steam(id);
    return transaction(()=>statusView(id));
  }
  function statusView(id) {
    const participating=Boolean(db.prepare('SELECT 1 FROM dc_participants WHERE steam_id=?').get(id));
    const revision=db.prepare('SELECT revision FROM dc_settings WHERE steam_id=?').get(id)?.revision||0;
    if(!enabled())return {enabled:false,participating,revision,timezone:'Australia/Brisbane',rewardsEnabled:false,location:locations.status(id),challenges:[]};
    const challenges=periods(now()).map(p=>{
      const rows=db.prepare(`SELECT amount FROM dc_evidence e WHERE steam_id=? AND cadence=? AND period_start=? AND challenge_id=?
        AND (challenge_id='species-three' OR EXISTS (SELECT 1 FROM dc_observations o WHERE o.steam_id=e.steam_id AND o.segment=e.subject))`)
        .all(id,p.cadence,p.start,p.definition.id);
      const amount=p.definition.id==='species-three'?rows.length:rows.reduce((best,r)=>Math.max(best,r.amount),0);
      return {...p.definition,cadence:p.cadence,startsAt:p.start,endsAt:p.end,progress:Math.min(p.definition.target,amount),completed:amount>=p.definition.target};
    });
    if(attendance.enabled()) {
      const week=periods(now())[1],joined=db.prepare('SELECT joined_at FROM dc_participants WHERE steam_id=?').get(id);
      const progress=joined?Math.min(1,attendance.count(id,{start:week.start,end:week.end,joinedAt:joined.joined_at})):0;
      challenges.push({id:'event-confirmed',title:'Join a Valley Event',metric:'confirmed_attendance',target:1,cadence:'weekly',startsAt:week.start,endsAt:week.end,progress,completed:progress>=1});
    }
    const location=locations.status(id);
    if(location.available){
      challenges.push({id:'travel-12km',title:'Roam 12 km',metric:'observed_metres',target:12000,cadence:'daily',startsAt:location.startsAt,endsAt:location.endsAt,progress:location.distanceMetres,completed:location.distanceMetres>=12000});
      challenges.push({id:'visit-highlands',title:'Visit Highlands',metric:'highlands_visit',target:1,cadence:'daily',startsAt:location.startsAt,endsAt:location.endsAt,progress:location.highlandsVisited?1:0,completed:location.highlandsVisited});
    }
    return {enabled:true,participating,revision,timezone:'Australia/Brisbane',rewardsEnabled:false,location,challenges};
  }
  return {change,observe,status,prune,reconcileDeath,attendance,locations};
}
module.exports={createDynamicChallengeStore,periods};
