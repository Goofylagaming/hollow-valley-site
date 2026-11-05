const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
process.env.DB_PATH=':memory:';
const {db}=require('../server/db');
const titles=require('../server/services/profileTitles');
const automation=require('../server/services/automationWebsiteClient');
const combat=require('../server/services/combatControlClient');
const a='76561198000000131',b='76561198000000132';
const proof={profile:{steamId:a,achievements:[{id:'quest-100'}]}};
test.after(()=>db.close());
test('batch title decoration matches identities, rechecks eligibility and respects clearing',async()=>{
  titles.chooseTitle(a,'quest-master',proof);
  const boards={kills:[{steamId:a},{steamId:b}],time:[{steam_id:a}]};let calls=0;
  const fetch=async ids=>{calls++;assert.deepEqual(ids,[a]);return {players:[{steamId:a,achievementIds:['quest-100']}]};};
  const decorated=await titles.leaderboardTitles(boards,fetch);
  assert.equal(calls,1);assert.equal(decorated.kills[0].selectedTitle.name,'Quest Master');
  assert.equal(decorated.time[0].selectedTitle.name,'Quest Master');assert.equal(decorated.kills[1].selectedTitle,null);
  assert.equal((await titles.leaderboardTitles(boards,async()=>({players:[{steamId:b,achievementIds:['quest-100']}]}))).kills[0].selectedTitle,null);
  assert.equal((await titles.leaderboardTitles(boards,async()=>({players:[{steamId:a,achievementIds:[]}]}))).kills[0].selectedTitle,null);
  await assert.rejects(titles.leaderboardTitles(boards,async()=>({stale:true,players:[]})),/Fresh/);
  await assert.rejects(titles.leaderboardTitles(boards,async()=>({players:[{steamId:a,achievementIds:[]},{steamId:a,achievementIds:[]}]})),/Ambiguous/);
  for(const verificationStatus of ['withdrawn','under-review']) assert.throws(()=>titles.chooseTitle(a,'quest-master',{profile:{steamId:a,achievements:[{id:'quest-100',verificationStatus}]}}),{status:400});
  titles.chooseTitle(a,null,proof);
  await titles.leaderboardTitles(boards,()=>{throw new Error('No selected titles should make no evidence request');});
});
test('all public leaderboard categories show verified choices and survive evidence outage',async()=>{
  titles.chooseTitle(a,'quest-master',proof);
  const originals={combat:combat.getLeaderboard,play:automation.getPlaytimeLeaderboard,levels:automation.getProgressionLeaderboard,evidence:automation.getTitleEvidence};
  let failed=false,calls=0;
  combat.getLeaderboard=async()=>({mostKills:[{steamId:a,username:'Player'}],bestKd:[{steamId:a}],mostDeaths:[{steamId:a}]});
  automation.getPlaytimeLeaderboard=async()=>({players:[{steam_id:a}]});
  automation.getProgressionLeaderboard=async()=>({players:[{steamId:a}]});
  automation.getTitleEvidence=async()=>{calls++;if(failed)throw new Error('offline');return {players:[{steamId:a,achievementIds:['quest-100']}]};};
  const app=express();app.use('/board',require('../server/routes/leaderboards'));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const url=`http://127.0.0.1:${server.address().port}/board`;
  try {
    const response=await fetch(url);assert.equal(response.headers.get('cache-control'),'no-store');
    const result=await response.json();assert.equal(calls,1);
    for(const key of ['dailyKills','dailyKd','dailyDeaths','weeklyKills','weeklyKd','weeklyDeaths','mostLevels','mostPlaytime'])assert.equal(result[key][0].selectedTitle.name,'Quest Master',key);
    failed=true;const fallback=await (await fetch(url)).json();
    assert.equal(fallback.dailyKills[0].username,'Player');assert.equal(fallback.dailyKills[0].selectedTitle,null);
  }finally{combat.getLeaderboard=originals.combat;automation.getPlaytimeLeaderboard=originals.play;automation.getProgressionLeaderboard=originals.levels;automation.getTitleEvidence=originals.evidence;await new Promise(resolve=>server.close(resolve));}
});
