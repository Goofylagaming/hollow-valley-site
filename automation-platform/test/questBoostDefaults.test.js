const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('approved quest boosts are application defaults when env overrides are absent', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-quest-defaults-'));
  const names = [
    'AUTOMATION_DB_PATH',
    'WALLET_QUEST_DAILY_1H_BOOST_PERCENT',
    'WALLET_QUEST_DAILY_3H_BOOST_PERCENT',
    'WALLET_QUEST_DAILY_6H_BOOST_PERCENT',
    'WALLET_QUEST_WEEKLY_12H_BOOST_PERCENT',
    'WALLET_QUEST_WEEKLY_24H_BOOST_PERCENT',
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));

  process.env.AUTOMATION_DB_PATH = path.join(dir, 'economy.sqlite');
  for (const name of names.slice(1)) delete process.env[name];

  const storePath = require.resolve('../src/services/economyStore');
  const questPath = require.resolve('../src/services/questBoostService');
  delete require.cache[storePath];
  delete require.cache[questPath];

  t.after(() => {
    delete require.cache[storePath];
    delete require.cache[questPath];
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const quests = require('../src/services/questBoostService');
  assert.deepEqual(
    quests.questDefinitions().map((quest) => quest.boostPercent),
    [5, 10, 15, 10, 20]
  );
});
