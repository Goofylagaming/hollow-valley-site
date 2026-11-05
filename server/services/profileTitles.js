"use strict";
const { db } = require('../db');

const TITLES = Object.freeze([
  { id: 'valley-regular', name: 'Valley Regular', achievement: 'level-10', requirement: 'Reach account level 10.' },
  { id: 'valley-veteran', name: 'Valley Veteran', achievement: 'playtime-100h', requirement: 'Log 100 verified hours in Hollow Valley.' },
  { id: 'ancient-one', name: 'Ancient One', achievement: 'playtime-250h', requirement: 'Log 250 verified hours in Hollow Valley.' },
  { id: 'living-fossil', name: 'Living Fossil', achievement: 'playtime-500h', requirement: 'Log 500 verified hours in Hollow Valley.' },
  { id: 'quest-master', name: 'Quest Master', achievement: 'quest-100', requirement: 'Complete 100 verified quests.' },
  { id: 'valley-socialite', name: 'Valley Socialite', achievement: 'event-25', requirement: 'Attend 25 confirmed events.' },
]);

db.exec(`CREATE TABLE IF NOT EXISTS profile_title_choices (
  steam_id TEXT PRIMARY KEY,
  title_id TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

function eligibleTitles(steamId, result) {
  if (!/^\d{17}$/.test(String(steamId)) || result?.stale || result?.profile?.steamId !== steamId
      || !Array.isArray(result.profile.achievements)) {
    throw Object.assign(new Error('Fresh verified progression for your Steam account is required.'), { status: 503 });
  }
  const earned = new Set(result.profile.achievements.filter(item=>!['withdrawn','under-review'].includes(item.verificationStatus)).map(item => item.id));
  return TITLES.map(title => ({ ...title, unlocked: earned.has(title.achievement) }));
}

function readTitles(steamId, result) {
  const titles = eligibleTitles(steamId, result);
  const selected = db.prepare('SELECT title_id FROM profile_title_choices WHERE steam_id = ?').get(steamId)?.title_id;
  return { titles, selectedTitleId: titles.some(t => t.id === selected && t.unlocked) ? selected : null };
}

function chooseTitle(steamId, titleId, result) {
  const titles = eligibleTitles(steamId, result);
  if (titleId !== null && !titles.some(t => t.id === titleId && t.unlocked)) {
    throw Object.assign(new Error('Choose a title you have unlocked.'), { status: 400 });
  }
  db.prepare(`INSERT INTO profile_title_choices (steam_id, title_id) VALUES (?, ?)
    ON CONFLICT(steam_id) DO UPDATE SET title_id = excluded.title_id, updated_at = datetime('now')`).run(steamId, titleId);
  return readTitles(steamId, result);
}

async function leaderboardTitles(boards,fetchEvidence) {
  const ids=[...new Set(Object.values(boards).flat().map(row=>row.steamId||row.steam_id).filter(id=>typeof id==='string'&&/^\d{17}$/.test(id)))];
  if(ids.length>800) throw new Error('Too many leaderboard identities');
  const choices=new Map();
  const query=db.prepare('SELECT title_id FROM profile_title_choices WHERE steam_id=?');
  for(const id of ids) {
    const choice=query.get(id)?.title_id;
    const title=TITLES.find(t=>t.id===choice);
    if(title) choices.set(id,title);
  }
  const verified=new Map();
  if(choices.size) {
    const evidence=await fetchEvidence([...choices.keys()]);
    if(evidence?.stale||!Array.isArray(evidence?.players)) throw new Error('Fresh title evidence unavailable');
    for(const player of evidence.players) {
      if(verified.has(player.steamId)) throw new Error('Ambiguous title evidence');
      if(!Array.isArray(player.achievementIds)) throw new Error('Invalid title evidence');
      verified.set(player.steamId,new Set(player.achievementIds));
    }
  }
  return Object.fromEntries(Object.entries(boards).map(([key,rows])=>[key,rows.map(row=>{
    const id=row.steamId||row.steam_id,title=choices.get(id);
    return {...row,selectedTitle:title&&verified.get(id)?.has(title.achievement)?{id:title.id,name:title.name}:null};
  })]));
}
module.exports = { readTitles, chooseTitle, leaderboardTitles };
