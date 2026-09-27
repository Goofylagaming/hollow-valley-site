const test = require('node:test');
const assert = require('node:assert/strict');
const { parseChatLine } = require('../scripts/game-chat-line');

test('parses the verified Hollow Valley Global chat line', () => {
  const line = '[2026.09.27-00.55.27:871][876]LogTheIsleChatData: [2026.09.27-10.55.27] [Global] [GROUP-1027772112] Joeyy [76561198449777255]: zurie hello';
  assert.deepEqual(parseChatLine(line), { channel: 'Global', name: 'Joeyy', steamId: '76561198449777255', message: 'zurie hello' });
});

test('parses verified Spatial chat and ignores ordinary game logs', () => {
  const line = '[2026.09.27-01.01.38:062][873]LogTheIsleChatData: [2026.09.27-11.01.38] [Spatial] [GROUP-1412674960] Goofy [76561198038977506]: test';
  assert.deepEqual(parseChatLine(line), { channel: 'Spatial', name: 'Goofy', steamId: '76561198038977506', message: 'test' });
  assert.equal(parseChatLine('[2026.09.27-00.55.28:001][876]LogTheIsleCommandData: RCON Command Used []'), null);
});

test('ignores chat entries containing only whitespace', () => {
  const line = '[2026.09.27-01.01.38:062][873]LogTheIsleChatData: [2026.09.27-11.01.38] [Spatial] [GROUP-1412674960] Goofy [76561198038977506]:   ';
  assert.equal(parseChatLine(line), null);
});
