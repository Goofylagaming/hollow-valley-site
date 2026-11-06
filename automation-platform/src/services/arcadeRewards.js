'use strict';

// All mutations use the economy connection: inventory, ledger and receipts commit together.
const { randomInt, randomUUID } = require('node:crypto');
const economy = require('./economyStore');
const arcade = require('./valleyArcade');
const db = economy.db;
const families = ['valley', 'alpha', 'prime', 'event'];
const fragmentCosts = { valley:10, alpha:15, prime:25, event:10 };
const enabled = () => process.env.VALLEY_ARCADE_REWARDS_ENABLED === '1';
const defaults = () => ({ dailyPlays:6, dailyXp:25, winXp:75, xpPerLevel:500,
  crates:Object.fromEntries(families.map((family,i) => [family, [
    { id:'coins', label:`${500*(i+1)} Valley Coins`, type:'coins', amount:500*(i+1), weight:90 },
    { id:'bonus', label:`${2500*(i+1)} Valley Coins`, type:'coins', amount:2500*(i+1), weight:10 }
  ]])) });

function schema() {
  db.exec(`CREATE TABLE IF NOT EXISTS arcade_rewards_config (
    id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, config_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS arcade_profiles (
      steam_id TEXT PRIMARY KEY, xp INTEGER NOT NULL DEFAULT 0 CHECK(xp>=0));
    CREATE TABLE IF NOT EXISTS arcade_daily_plays (
      steam_id TEXT NOT NULL, day TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0 CHECK(used>=0),
      PRIMARY KEY(steam_id,day));
    CREATE TABLE IF NOT EXISTS arcade_fragments (
      steam_id TEXT NOT NULL, family TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>=0),
      PRIMARY KEY(steam_id,family));
    CREATE TABLE IF NOT EXISTS arcade_crates (
      id TEXT PRIMARY KEY, steam_id TEXT NOT NULL, family TEXT NOT NULL, source TEXT NOT NULL,
      version INTEGER NOT NULL, rewards_json TEXT NOT NULL, earned_at INTEGER NOT NULL,
      opened_at INTEGER, reward_json TEXT);
    CREATE INDEX IF NOT EXISTS arcade_crates_owner ON arcade_crates(steam_id,opened_at,earned_at);
    CREATE TABLE IF NOT EXISTS arcade_entitlements (
      id TEXT PRIMARY KEY, steam_id TEXT NOT NULL, reward_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ready', created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS arcade_entitlements_owner ON arcade_entitlements(steam_id,created_at);
    CREATE TABLE IF NOT EXISTS arcade_reward_receipts (
      steam_id TEXT NOT NULL, request_key TEXT NOT NULL, action TEXT NOT NULL,
      payload_json TEXT NOT NULL, result_json TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY(steam_id,request_key));
    CREATE TABLE IF NOT EXISTS arcade_rewards_audit (
      id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL,
      details_json TEXT NOT NULL, created_at INTEGER NOT NULL);`);
  db.prepare('INSERT OR IGNORE INTO arcade_rewards_config VALUES (1,1,?)').run(JSON.stringify(defaults()));
}
function config() {
  schema();
  const row = db.prepare('SELECT * FROM arcade_rewards_config WHERE id=1').get();
  return { version:row.version, ...JSON.parse(row.config_json) };
}
function assertOpen() {
  if (!enabled() || process.env.VALLEY_ARCADE_ENABLED !== '1') throw new Error('Arcade rewards disabled');
  const settings = arcade.settings();
  if (!settings.enabled || settings.emergency) throw new Error('Arcade paused');
}
function integer(n,min,max) {
  if (!Number.isSafeInteger(n) || n<min || n>max) throw new Error('Invalid whole-number amount');
  return n;
}
function audit(actor,action,details,now=Date.now()) {
  db.prepare('INSERT INTO arcade_rewards_audit(actor,action,details_json,created_at) VALUES (?,?,?,?)')
    .run(actor,action,JSON.stringify(details),now);
}
function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result=fn(); db.exec('COMMIT'); return result; }
  catch(error) { db.exec('ROLLBACK'); throw error; }
}
function operation(steamId,key,action,payload,fn,now=Date.now()) {
  const steam=economy.validateSteamId(steamId);
  if (!/^[A-Za-z0-9:_-]{8,128}$/.test(key || '')) throw new Error('A request key is required');
  schema();
  return transaction(() => {
    const old=db.prepare('SELECT * FROM arcade_reward_receipts WHERE steam_id=? AND request_key=?').get(steam,key);
    const json=JSON.stringify(payload);
    if (old) {
      if (old.action!==action || old.payload_json!==json) throw new Error('Request key conflicts with an earlier action');
      return {...JSON.parse(old.result_json),duplicate:true};
    }
    assertOpen();
    economy.ensureWallet(steam);
    db.prepare('INSERT OR IGNORE INTO arcade_profiles(steam_id) VALUES (?)').run(steam);
    const result=fn(steam);
    db.prepare('INSERT INTO arcade_reward_receipts VALUES (?,?,?,?,?,?)').run(steam,key,action,json,JSON.stringify(result),now);
    audit(steam,action,{requestKey:key,...payload,result},now);
    return {...result,duplicate:false};
  });
}
function validateReward(r) {
  if (!r || !/^[a-z0-9_-]{1,50}$/.test(r.id) || typeof r.label!=='string' || !r.label.trim() || r.label.length>120) throw new Error('Invalid reward');
  const out={id:r.id,label:r.label.trim(),type:r.type,weight:integer(r.weight,1,1000000)};
  if (r.type==='coins') out.amount=integer(r.amount,1,1000000);
  else if (r.type==='skin') {
    const preset=economy.getSkinPreset(r.presetId);
    if (!preset?.active) throw new Error('Choose an active Skin Studio preset');
    if (!['convert','reroll'].includes(r.duplicate)) throw new Error('Choose duplicate conversion or reroll');
    Object.assign(out,{presetId:preset.id,duplicate:r.duplicate,duplicateCoins:integer(r.duplicateCoins,1,1000000)});
  } else if (r.type==='dinosaur') {
    if (!/^[A-Za-z][A-Za-z0-9_-]{1,63}$/.test(r.species)) throw new Error('Invalid dinosaur species');
    Object.assign(out,{species:r.species,growthPercent:integer(r.growthPercent,1,100)});
  } else throw new Error('Only coins, skins and dinosaur entitlements are supported');
  return out;
}
function configure(actor,input,expectedVersion) {
  if (!actor) throw new Error('Admin actor required');
  schema();
  return transaction(() => {
    const current=config();
    if (current.version!==expectedVersion) throw new Error('Configuration changed; reload before saving');
    const next={dailyPlays:integer(input.dailyPlays,1,100),dailyXp:integer(input.dailyXp,0,500),
      winXp:integer(input.winXp,1,500),xpPerLevel:500,crates:{}};
    // XP thresholds never change after launch; avoid retroactive milestone grants.
    for (const family of families) {
      const pool=input.crates?.[family];
      if (!Array.isArray(pool) || !pool.length || pool.length>100) throw new Error('Each crate needs 1–100 rewards');
      next.crates[family]=pool.map(validateReward);
      if (new Set(pool.map(r=>r.id)).size!==pool.length) throw new Error('Reward IDs must be unique within a crate');
    }
    db.prepare('UPDATE arcade_rewards_config SET version=version+1,config_json=? WHERE id=1').run(JSON.stringify(next));
    audit(String(actor),'configure',{version:current.version+1,config:next});
    return config();
  });
}
function grantCrate(steam,family,source,now) {
  if (!families.includes(family)) throw new Error('Unknown crate family');
  const c=config(),id=randomUUID();
  db.prepare('INSERT INTO arcade_crates(id,steam_id,family,source,version,rewards_json,earned_at) VALUES (?,?,?,?,?,?,?)')
    .run(id,steam,family,source,c.version,JSON.stringify(c.crates[family]),now);
  return id;
}
function addFragments(steam,family,amount) {
  if (!families.includes(family)) throw new Error('Unknown fragment family');
  db.prepare(`INSERT INTO arcade_fragments VALUES (?,?,?) ON CONFLICT(steam_id,family)
    DO UPDATE SET quantity=quantity+excluded.quantity`).run(steam,family,integer(amount,1,1000));
}
function addXp(steam,amount,source,now) {
  db.prepare('INSERT OR IGNORE INTO arcade_profiles(steam_id) VALUES (?)').run(steam);
  const old=db.prepare('SELECT xp FROM arcade_profiles WHERE steam_id=?').get(steam).xp;
  const xp=Math.min(49500,old+amount);
  db.prepare('UPDATE arcade_profiles SET xp=? WHERE steam_id=?').run(xp,steam);
  // Free progression: every fifth level earns a crate, with higher milestone families.
  for(let level=Math.floor(old/500)+2;level<=Math.floor(xp/500)+1;level++) {
    if(level%5===0) grantCrate(steam,level>=90?'prime':level%20===0?'alpha':'valley',`level:${level}`,now);
  }
  return xp;
}
function daily(steam,key,now=Date.now()) {
  const day=arcade.dayKey(now);
  // The day is the natural idempotency key, even across browsers and devices.
  return operation(steam,`daily:${day}`,'daily',{day},id=>{
    const xp=addXp(id,config().dailyXp,'daily',now); addFragments(id,'valley',1);
    return {day,xp,fragments:1};
  },now);
}
// Called inside the existing game start/settle transaction only.
function consumePlay(steam,now) {
  const day=arcade.dayKey(now),c=config();
  db.prepare('INSERT OR IGNORE INTO arcade_daily_plays(steam_id,day) VALUES (?,?)').run(steam,day);
  const changed=db.prepare('UPDATE arcade_daily_plays SET used=used+1 WHERE steam_id=? AND day=? AND used<?').run(steam,day,c.dailyPlays);
  if (!changed.changes) throw new Error('All daily free plays used. Return tomorrow.');
}
function rewardRound(steam,roundId,score,now) {
  // Existing settled-round check prevents repeats; this shares its transaction.
  if (!score) return;
  const xp=addXp(steam,config().winXp,'game',now);
  addFragments(steam,'valley',1);
  audit(steam,'game_reward',{roundId,xp,fragments:1},now);
}
function ownsSkin(steam,r) {
  return economy.hasSkinUnlock(steam,r.presetId) || economy.hasSkinGrant(steam,r.presetId) || economy.getSkinPreset(r.presetId)?.owner_steam_id===steam;
}
function poolFor(steam,pool) {
  const filtered=pool.filter(r=>!(r.type==='skin' && r.duplicate==='reroll' && ownsSkin(steam,r)));
  return filtered.length ? filtered : pool; // all-owned pools convert instead of looping forever
}
function odds(steam,pool) {
  const effective=poolFor(steam,pool),total=effective.reduce((n,r)=>n+r.weight,0);
  return pool.map(r=>({...r,probability:effective.includes(r)?r.weight/total:0,
    duplicateConversion:r.type==='skin' && ownsSkin(steam,r)?r.duplicateCoins:null}));
}
function weighted(pool,draw=randomInt) {
  const total=pool.reduce((n,r)=>n+r.weight,0);let pick=draw(total);
  if(!Number.isInteger(pick)||pick<0||pick>=total) throw new Error('Invalid random draw');
  for(const reward of pool) { if(pick<reward.weight)return reward;pick-=reward.weight; }
  throw new Error('Empty reward pool');
}
function credit(steam,amount,id) {
  const wallet=economy.ensureWallet(steam);
  if(!Number.isSafeInteger(wallet.balance+amount)) throw new Error('Wallet balance limit reached');
  db.prepare('UPDATE economy_wallets SET balance=balance+?,updated_at=CURRENT_TIMESTAMP WHERE steam_id=?').run(amount,steam);
  db.prepare(`INSERT INTO economy_wallet_ledger(id,steam_id,amount,kind,reason,idempotency_key,reference_type,reference_id)
    VALUES (?,?,?,'arcade_crate','Earned Arcade crate reward',?,'arcade_crate',?)`).run(randomUUID(),steam,amount,`arcade-crate:${id}`,id);
}
function open(steam,key,crateId,now=Date.now()) {
  return operation(steam,key,'open',{crateId},id=>{
    const crate=db.prepare('SELECT * FROM arcade_crates WHERE id=? AND steam_id=?').get(crateId,id);
    if(!crate) throw new Error('Crate not found');
    if(crate.opened_at!==null) return {crateId,reward:JSON.parse(crate.reward_json),alreadyOpened:true};
    const pool=JSON.parse(crate.rewards_json),displayOdds=odds(id,pool);
    let reward={...weighted(poolFor(id,pool))};
    if(reward.type==='skin') {
      if(ownsSkin(id,reward)) reward={type:'coins',amount:reward.duplicateCoins,label:`${reward.duplicateCoins} VC (duplicate skin)`,convertedFrom:reward.presetId};
      else {
        if(!economy.getSkinPreset(reward.presetId)?.active) throw new Error('A reward skin is unavailable; your crate is preserved');
        db.prepare('INSERT INTO economy_skin_unlocks(steam_id,preset_id,purchase_price,idempotency_key) VALUES (?,?,0,?)')
          .run(id,reward.presetId,`arcade-crate:${crateId}`);
      }
    }
    if(reward.type==='coins') credit(id,reward.amount,crateId);
    if(reward.type==='dinosaur') {
      reward.entitlementId=randomUUID();
      db.prepare('INSERT INTO arcade_entitlements(id,steam_id,reward_json,created_at) VALUES (?,?,?,?)')
        .run(reward.entitlementId,id,JSON.stringify(reward),now);
    }
    db.prepare('UPDATE arcade_crates SET opened_at=?,reward_json=? WHERE id=?').run(now,JSON.stringify(reward),crateId);
    return {crateId,reward,version:crate.version,odds:displayOdds};
  },now);
}
function craft(steam,key,family,now=Date.now()) {
  return operation(steam,key,'craft',{family},id=>{
    if(!families.includes(family))throw new Error('Unknown crate family');
    const changed=db.prepare('UPDATE arcade_fragments SET quantity=quantity-? WHERE steam_id=? AND family=? AND quantity>=?')
      .run(fragmentCosts[family],id,family,fragmentCosts[family]);
    if(!changed.changes)throw new Error('Not enough earned fragments');
    return {crateId:grantCrate(id,family,'fragments',now)};
  },now);
}
function grant(actor,steam,key,{kind,family,amount,source},now=Date.now()) {
  if(!actor || !['quest','playtime','event','achievement'].includes(source))throw new Error('A verified earned source is required');
  integer(amount,1,kind==='xp'?500:100);
  return operation(steam,`grant:${key}`,'grant',{actor:String(actor),kind,family:family||null,amount,source},id=>{
    let result;
    if(kind==='xp')result={xp:addXp(id,amount,source,now)};
    else if(kind==='fragments'){addFragments(id,family,amount);result={family,amount};}
    else if(kind==='crate')result={crateIds:Array.from({length:amount},()=>grantCrate(id,family,source,now))};
    else throw new Error('Unsupported earned grant');
    audit(String(actor),'admin_grant',{steamId:id,source,kind,amount,key},now);
    return result;
  },now);
}
function state(steam,now=Date.now()) {
  const id=economy.validateSteamId(steam);schema();assertOpen();
  const c=config(),day=arcade.dayKey(now);
  const xp=db.prepare('SELECT xp FROM arcade_profiles WHERE steam_id=?').get(id)?.xp||0;
  const deliveries=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='arcade_dino_deliveries'").get()
    ? db.prepare(`SELECT d.entitlement_id,d.status,d.message,d.command_json FROM arcade_dino_deliveries d
      JOIN arcade_entitlements e ON e.id=d.entitlement_id WHERE e.steam_id=?`).all(id)
      .map(({command_json,...row})=>({...row,slot:JSON.parse(command_json).args?.args?.[0]||null})) : [];
  return {deliveryEnabled:process.env.VALLEY_ARCADE_DINO_DELIVERY_ENABLED==='1',deliveries,xp,level:Math.min(100,Math.floor(xp/500)+1),xpPerLevel:500,
    balance:economy.getWallet(id).balance,day,dailyClaimed:!!db.prepare('SELECT 1 FROM arcade_reward_receipts WHERE steam_id=? AND request_key=?').get(id,`daily:${day}`),
    playsRemaining:Math.max(0,c.dailyPlays-(db.prepare('SELECT used FROM arcade_daily_plays WHERE steam_id=? AND day=?').get(id,day)?.used||0)),
    fragmentCosts,fragments:db.prepare('SELECT family,quantity FROM arcade_fragments WHERE steam_id=?').all(id),
    catalog:families.map(family=>({family,version:c.version,odds:odds(id,c.crates[family])})),
    crates:db.prepare('SELECT * FROM arcade_crates WHERE steam_id=? AND opened_at IS NULL ORDER BY earned_at,id').all(id)
      .map(({rewards_json,...r})=>({...r,odds:odds(id,JSON.parse(rewards_json))})),
    entitlements:db.prepare('SELECT * FROM arcade_entitlements WHERE steam_id=? ORDER BY created_at DESC').all(id)
      .map(({reward_json,...r})=>({...r,reward:JSON.parse(reward_json)})),
    history:db.prepare('SELECT id,family,opened_at,reward_json FROM arcade_crates WHERE steam_id=? AND opened_at IS NOT NULL ORDER BY opened_at DESC LIMIT 100').all(id)
      .map(({reward_json,...r})=>({...r,reward:JSON.parse(reward_json)}))};
}
function adminState() {
  schema();
  return {config:config(),audit:db.prepare('SELECT * FROM arcade_rewards_audit ORDER BY id DESC LIMIT 100').all(),
    totals:db.prepare('SELECT count(*) AS earned, count(opened_at) AS opened FROM arcade_crates').get(),
    coinsAwarded:db.prepare("SELECT coalesce(sum(amount),0) AS total FROM economy_wallet_ledger WHERE kind='arcade_crate'").get().total};
}
module.exports={enabled,schema,config,configure,state,adminState,daily,open,craft,grant,consumePlay,rewardRound,weighted,odds};
