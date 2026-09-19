const test = require('node:test');
const assert = require('node:assert/strict');

const discord = require('../src/services/discordAutomationService');

test('formats Discord status channel names', () => {
  assert.equal(discord.formatStatusChannelName({ configured: false }), 'server-status-unavailable');
  assert.equal(discord.formatStatusChannelName({ configured: true, online: false }), '🔴-hollow-valley-offline');
  assert.equal(discord.formatStatusChannelName({ configured: true, online: true, players: [{}, {}, {}], maxPlayers: 100 }), '🟢-hollow-valley-3-100-online');
});

test('validates announcement text', () => {
  assert.throws(() => discord.cleanMessage('   '), /required/);
  assert.throws(() => discord.cleanMessage('x'.repeat(1901)), /1900/);
  assert.equal(discord.cleanMessage('  Hollow Valley update.  '), 'Hollow Valley update.');
});
