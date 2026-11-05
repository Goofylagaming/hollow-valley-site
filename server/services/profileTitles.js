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
  const earned = new Set(result.profile.achievements.map(item => item.id));
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

module.exports = { readTitles, chooseTitle };
