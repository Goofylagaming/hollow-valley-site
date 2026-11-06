"use strict";
// Source clocks for future season review. These are not new XP or rewards.
const BASIS=Object.freeze({
 'playtime-observation':{source:'playtime',referenceType:'playtime_interval'},
 'quest-achievement':{source:'quest',referenceType:'quest'},
 'event-confirmation':{source:'event',referenceType:'event'},
});
function parseSourceTimestamp(value){
 if(typeof value!=='string')return null;
 const match=/^(\d{4})-(\d{2})-(\d{2})(T| )(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
 if(!match||match[4]==='T'&&!match[9])return null;
 const [year,month,day,hour,minute,second]=[match[1],match[2],match[3],match[5],match[6],match[7]].map(Number);
 if(year<1970||month<1||month>12||hour>23||minute>59||second>59||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate())return null;
 if(match[9]&&match[9]!=='Z'){const hours=Number(match[9].slice(1,3)),minutes=Number(match[9].slice(4));if(hours>14||minutes>59||hours===14&&minutes!==0)return null;}
 const at=Date.parse(value.replace(' ','T')+(match[9]?'':'Z'));
 return Number.isSafeInteger(at)&&at>=0?at:null;
}
function createProgressionSourceTimeStore(db,{now=Date.now}={}){
 db.exec(`CREATE TABLE IF NOT EXISTS progression_xp_source_times(ledger_id TEXT PRIMARY KEY REFERENCES progression_xp_ledger(id),
 source_at INTEGER NOT NULL,basis TEXT NOT NULL CHECK(basis IN ('playtime-observation','quest-achievement','event-confirmation')));
 CREATE INDEX IF NOT EXISTS progression_xp_source_time ON progression_xp_source_times(source_at);`);
 function recordNewGrant(ledgerId,{source,referenceType,sourceTime}={}){
  const contract=sourceTime&&typeof sourceTime.basis==='string'&&Object.hasOwn(BASIS,sourceTime.basis)?BASIS[sourceTime.basis]:null,at=sourceTime?.at;
  // Unknown or ambiguous timing never changes an existing grant's behavior.
  // In particular, receiving an old grant again must never stamp it as new.
  if(!contract||contract.source!==source||contract.referenceType!==referenceType||!Number.isSafeInteger(at)||at<0||at>now()+120000)return false;
  return Boolean(db.prepare(`INSERT INTO progression_xp_source_times(ledger_id,source_at,basis)
    SELECT id,?,? FROM progression_xp_ledger WHERE id=? AND source=? AND reference_type=?`).run(at,sourceTime.basis,ledgerId,source,referenceType).changes);
 }
 const read=ledgerId=>db.prepare('SELECT source_at AS sourceAt,basis FROM progression_xp_source_times WHERE ledger_id=?').get(ledgerId)||null;
 return {recordNewGrant,read};
}
module.exports={createProgressionSourceTimeStore,parseSourceTimestamp};
