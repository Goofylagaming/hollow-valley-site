'use strict';
const {createTerritoryBattleContext}=require('./territoryBattleContext');
const validTime=value=>Number.isSafeInteger(value)&&value>=0&&value<=8640000000000000;
const validGroup=value=>Number.isSafeInteger(value)&&value>0;
function createTerritorySeasonEvidence(db,{plans,now=Date.now}={}){
 const context=createTerritoryBattleContext(db),exists=name=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
 const fail=message=>{throw Object.assign(Error(message),{status:503});};
 function read(actor,seasonId){
  if(typeof seasonId!=='string'||!/^season-[a-z0-9][a-z0-9-]{0,56}$/.test(seasonId))throw Object.assign(Error('A saved season reference is required'),{status:400});
  db.exec('SAVEPOINT season_evidence_read');try{
   const definitions=plans.list(actor);if(!definitions.available)fail('Season planning storage is unavailable');const plan=definitions.seasons.find(row=>row.seasonId===seasonId);if(!plan)throw Object.assign(Error('Season plan not found'),{status:404});
   const at=now();if(!validTime(at)||at>8640000000000000-120000||at<plan.updatedAt)fail('The season evidence clock is unavailable');
   const base={kind:'draft-window-evidence',seasonId,planRevision:plan.revision,startsAt:plan.startsAt,endsAt:plan.endsAt,readAt:at,expiresAt:at+120000,runtimeActivated:false,officialResults:false,champion:null,holdingTime:null,defensiveStreaks:null};
   const finish=value=>{db.exec('RELEASE season_evidence_read');return {...base,...value};};
   if(plan.state==='cancelled')return finish({available:false,status:'cancelled',groups:null,territories:null});
   if(at<plan.startsAt)return finish({available:false,status:'not-started',groups:null,territories:null});
   if(!['territory_battle_provenance','territory_battle_sample_clock','territory_battle_winners','territory_battle_context','hv_group_battle_identity'].every(exists))return finish({available:false,status:'source-unavailable',groups:null,territories:null});
   const rows=db.prepare(`SELECT b.*,c.verified sample_clock,a.group_id attacker_group,d.group_id defender_group,
    EXISTS(SELECT 1 FROM territory_battle_winners w WHERE w.attack_id=b.attack_id AND typeof(w.steam_id)='text' AND length(w.steam_id)=17 AND w.steam_id NOT GLOB '*[^0-9]*') has_winner
    FROM territory_battle_provenance b LEFT JOIN territory_battle_sample_clock c ON c.attack_id=b.attack_id
    LEFT JOIN hv_group_battle_identity a ON a.attack_id=b.attack_id AND a.side='attacker'
    LEFT JOIN hv_group_battle_identity d ON d.attack_id=b.attack_id AND d.side='defender'
    WHERE typeof(b.started_at)='integer' AND b.started_at>=? AND b.started_at<? AND b.started_at<=?
    ORDER BY b.started_at,b.attack_id LIMIT 10001`).all(plan.startsAt,plan.endsAt,at);
   if(rows.length>10000)fail('Season evidence capacity requires review');
   const unassigned=db.prepare("SELECT COUNT(*) n FROM territory_battle_provenance WHERE typeof(started_at)<>'integer' OR started_at<0 OR started_at>8640000000000000");unassigned.setReadBigInts(true);const unknownStarts=unassigned.get().n;if(unknownStarts>BigInt(Number.MAX_SAFE_INTEGER))fail('Season evidence totals require review');
   const excluded={disqualified:0,unverifiedClock:0,unresolved:0,outsideWindow:0,invalidResult:0,missingWinner:0,unknownTerritory:0,invalidIdentity:0},groups=new Map(),territories=new Set(),seen=new Set();let verifiedBattles=0,unattributedSides=0;
   const group=id=>{if(!groups.has(id))groups.set(id,{groupId:id,attacksWon:0,defencesWon:0,losses:0});return groups.get(id);};
   for(const row of rows){
    if(seen.has(row.attack_id))fail('Season evidence identities require review');seen.add(row.attack_id);
    if(!Number.isSafeInteger(row.attack_id)||row.attack_id<1||!validTime(row.started_at))fail('Season evidence identities require review');
    if(row.disqualified_reason!==null||row.live_observed!==1){excluded.disqualified++;continue;}
    if(row.sample_clock!==1){excluded.unverifiedClock++;continue;}
    if(row.closed_at===null){excluded.unresolved++;continue;}
    if(!validTime(row.closed_at)||row.closed_at<row.started_at||!['capture','defence'].includes(row.outcome)){excluded.invalidResult++;continue;}
    if(row.closed_at>=plan.endsAt||row.closed_at>at){excluded.outsideWindow++;continue;}
    if(row.has_winner!==1){excluded.missingWinner++;continue;}
    const frozen=context.read(row.attack_id);if(!frozen.available){excluded.unknownTerritory++;continue;}
    if([row.attacker_group,row.defender_group].some(id=>id!==null&&!validGroup(id))||row.attacker_group!==null&&row.attacker_group===row.defender_group){excluded.invalidIdentity++;continue;}
    verifiedBattles++;territories.add(frozen.territory.key);
    for(const [side,id] of [['attacker',row.attacker_group],['defender',row.defender_group]]){if(id===null){unattributedSides++;continue;}const totals=group(id),won=row.outcome==='capture'?side==='attacker':side==='defender';if(!won)totals.losses++;else if(side==='attacker')totals.attacksWon++;else totals.defencesWon++;}
    if(groups.size>500||territories.size>500)fail('Season evidence capacity requires review');
   }
   return finish({available:true,status:'preview',windowEnded:at>=plan.endsAt,asOf:Math.min(at,plan.endsAt),candidates:rows.length,verifiedBattles,excluded,unassignedDeclarations:Number(unknownStarts),unattributedSides,groups:[...groups.values()].sort((a,b)=>a.groupId-b.groupId),territories:[...territories].sort()});
  }catch(error){db.exec('ROLLBACK TO season_evidence_read;RELEASE season_evidence_read');throw error;}
 }
 return {read};
}
module.exports={createTerritorySeasonEvidence};
