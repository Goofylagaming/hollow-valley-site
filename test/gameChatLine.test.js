const test = require('node:test');
const assert = require('node:assert/strict');
const { parseChatLine } = require('../scripts/game-chat-line');

test('parses the verified Hollow Valley Global chat line', () => {
  const line = '[2026.09.27-00.55.27:871][876]LogTheIsleChatData: [2026.09.27-10.55.27] [Global] [GROUP-1027772112] Joeyy [76561198449777255]: zurie hello';
  assert.deepEqual(parseChatLine(line), { channel: 'Global', name: 'Joeyy', message: 'zurie hello' });
});

test('captures other explicit channel labels and ignores ordinary game logs', () => {
  const line = '[2026.09.27-00.55.28:001][876]LogTheIsleChatData: [2026.09.27-10.55.28] [Local] Player With Spaces [76561198449777255]: anyone lagging?';
  assert.deepEqual(parseChatLine(line), { channel: 'Local', name: 'Player With Spaces', message: 'anyone lagging?' });
  assert.equal(parseChatLine('[2026.09.27-00.55.28:001][876]LogTheIsleCommandData: RCON Command Used []'), null);
});
