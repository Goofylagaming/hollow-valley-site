"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
process.env.AUTOMATION_DB_PATH=':memory:';process.env.PLAYER_PRESENCE_ENABLED='true';process.env.JOIN_MESSAGE_ENABLED='false';
const status=require('../automation-platform/src/services/statusService');
let snapshot;const originalStatus=status.getServerSnapshot;status.getServerSnapshot=async()=>snapshot;
const prime=require('../automation-platform/src/services/primeTrackerService'),progression=require('../automation-platform/src/services/progressionService');
const legacy=require('../automation-platform/src/services/valleyLegacyService'),supporter=require('../automation-platform/src/services/supporterBonusService');
const playtime=require('../automation-platform/src/services/playtimeRewardsService'),species=require('../automation-platform/src/services/speciesCoinEventService');
const originals={prime:prime.recordSnapshot,xp:progression.trackOnlinePlayers,legacy:legacy.recordSnapshot,supporter:supporter.refreshMemberships,wallet:playtime.rewardOnlinePlayers,species:species.processSnapshot};
const calls={prime:[],xp:[],legacy:[]};
prime.recordSnapshot=(players,at)=>{calls.prime.push({players,at});return {tracked:players.length};};
progression.trackOnlinePlayers=(players,options)=>{calls.xp.push({players,options});return {trackedPlayers:players.length};};
legacy.recordSnapshot=(players,at)=>calls.legacy.push({players,at});
supporter.refreshMemberships=async()=>({skipped:true});playtime.rewardOnlinePlayers=()=>({skipped:true});species.processSnapshot=()=>({skipped:true});
const presence=require('../automation-platform/src/services/playerPresenceService');
test.after(()=>{status.getServerSnapshot=originalStatus;prime.recordSnapshot=originals.prime;progression.trackOnlinePlayers=originals.xp;legacy.recordSnapshot=originals.legacy;supporter.refreshMemberships=originals.supporter;playtime.rewardOnlinePlayers=originals.wallet;species.processSnapshot=originals.species;});
test('fresh Prime and playtime observations use the source check clock and rich character facts; cached/external/stale data is not re-timestamped',async()=>{
 const at=new Date(Date.now()-60000).toISOString(),steamId='76561198000000401';
 snapshot={configured:true,online:true,checkedAt:at,players:[{steamId,name:'Synthetic'}],characters:[{steamId,species:'Rex',growth:1,isPrime:true,location:{x:1,y:2}}]};
 await presence.samplePresence({force:true});
 assert.equal(calls.prime.length,1);assert.equal(calls.prime[0].at,at);assert.equal(calls.prime[0].players[0].isPrime,true);assert.equal(calls.prime[0].players[0].growth,1);
 assert.equal(calls.xp[0].options.nowMs,Date.parse(at));assert.equal(calls.legacy[0].at,at);
 for(const patch of [{cached:true},{source:'external-presence'},{stale:true},{checkedAt:'invalid'},{checkedAt:new Date(Date.now()+3600000).toISOString()}]){
  const prior={prime:calls.prime.length,xp:calls.xp.length,legacy:calls.legacy.length};snapshot={configured:true,online:true,checkedAt:at,players:[{steamId}],characters:[{steamId,isPrime:true}],...patch};
  const result=await presence.samplePresence({force:true});assert.equal(result.primeTracking.skipped,true);assert.equal(result.progression.skipped,true);
  assert.deepEqual({prime:calls.prime.length,xp:calls.xp.length,legacy:calls.legacy.length},prior);
 }
});
test('external ingestion rejects ambiguous source clocks before any Prime or progression callback',async()=>{
 const before={prime:calls.prime.length,xp:calls.xp.length};
 for(const sampledAt of ['2026-11-06T01:02:03','2026-02-30T01:02:03Z',null])await assert.rejects(presence.ingestExternalPresenceSnapshot({sampleId:'synthetic-invalid-clock',sampledAt,players:[]}),{code:'PRESENCE_SAMPLE_INVALID'});
 assert.deepEqual({prime:calls.prime.length,xp:calls.xp.length},before);
});
