'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
process.env.DB_PATH = ':memory:';
const { db } = require('../server/db');
const titles = require('../server/services/profileTitles');
const automation = require('../server/services/automationWebsiteClient');
const express = require('express');
const router = require('../server/routes/progression');
const a = '76561198000000001';
const b = '76561198000000002';
const verified = (steamId = a, ids = ['quest-100']) => ({ profile: { steamId, achievements: ids.map(id => ({ id })) } });
test.after(() => db.close());

test('only verified permanent achievements unlock titles; choice persists per Steam identity', () => {
  const result = verified();
  assert.equal(titles.readTitles(a, result).selectedTitleId, null);
  assert.equal(titles.chooseTitle(a, 'quest-master', result).selectedTitleId, 'quest-master');
  assert.equal(titles.readTitles(a, result).selectedTitleId, 'quest-master');
  assert.equal(titles.readTitles(b, verified(b)).selectedTitleId, null);
  assert.throws(() => titles.chooseTitle(a, 'valley-veteran', result), { status: 400 });
  assert.throws(() => titles.chooseTitle(a, '<script>', result), { status: 400 });
  assert.throws(() => titles.chooseTitle(a, undefined, result), { status: 400 });
  assert.equal(titles.readTitles(a, result).selectedTitleId, 'quest-master');
  assert.equal(titles.chooseTitle(a, null, result).selectedTitleId, null);
});

test('stale, wrong-account and malformed progression never authorize a title', () => {
  for (const result of [{ ...verified(), stale: true }, verified(b), { profile: { steamId: a } }, {}]) {
    assert.throws(() => titles.chooseTitle(a, 'quest-master', result), { status: 503 });
  }
  const result = verified(a, []);result.profile.level = 999;result.profile.verifiedPlaytimeMinutes = 999999;
  assert.equal(titles.readTitles(a, result).titles.some(t => t.unlocked), false);
});

test('title routes require same-origin authenticated identity and ignore forged request achievements', async () => {
  const original = automation.getProgression;
  let unavailable = false;
  automation.getProgression = async steamId => {
    if (unavailable) throw new Error('offline');
    return verified(steamId);
  };
  const app = express();app.use(express.json());
  app.use((req, res, next) => { if (req.get('X-Test-Steam')) req.user = { steam_id: req.get('X-Test-Steam') }; next(); });
  app.use('/api/progression', router);
  const server = app.listen(0, '127.0.0.1');await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, extra = {}) => fetch(base + '/api/progression/titles', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', 'X-Test-Steam': a, ...extra }, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(base + '/api/progression/titles')).status, 401);
    assert.equal((await post({ titleId: 'quest-master' }, { Origin: 'https://evil.invalid' })).status, 403);
    assert.equal((await post({ titleId: 'quest-master' }, { 'X-Test-Steam': 'invalid' })).status, 400);
    assert.equal((await post({ titleId: 'valley-veteran', achievements: ['playtime-100h'], steamId: b })).status, 400);
    const response = await post({ titleId: 'quest-master', steamId: b });
    assert.equal(response.status, 200);assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).selectedTitleId, 'quest-master');
    assert.equal(titles.readTitles(b, verified(b)).selectedTitleId, null);
    unavailable = true;
    assert.equal((await post({ titleId: null })).status, 503);
    assert.equal(titles.readTitles(a, verified()).selectedTitleId, 'quest-master');
  } finally { automation.getProgression = original; await new Promise(resolve => server.close(resolve)); }
});

test('retiring title roadmap votes preserves history and frees all active ballot slots', () => {
  const voting = require('../server/services/roadmapCommunity');
  db.prepare('INSERT INTO roadmap_votes (steam_id, feature_id) VALUES (?, 1)').run(a);
  for (const id of [5,6,28]) voting.setVote(a,id,true);
  assert.deepEqual(voting.voteSummary(a).myVotes,[5,6,28]);
  assert.equal(voting.voteSummary(a).counts[1],1);
  assert.throws(() => voting.setVote(a,1,true), { code: 'FEATURE_NOT_VOTABLE' });
});
