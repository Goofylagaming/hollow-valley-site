const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

test('automation service cannot become a second Discord bot by configuration', () => {
  const env = read('.env.example');
  const render = read('render.yaml');
  const pkg = JSON.parse(read('package.json'));

  assert.equal(env.includes('DISCORD_BOT_TOKEN='), false);
  assert.equal(render.includes('key: DISCORD_BOT_TOKEN'), false);
  assert.equal(Object.hasOwn(pkg.dependencies || {}, 'discord.js'), false);
});

test('automation Discord facade uses HerbyBot outbox and no direct Discord REST API', () => {
  const service = read('src/services/discordAutomationService.js');
  assert.equal(service.includes('discord.com/api'), false);
  assert.equal(service.includes('Authorization: `Bot'), false);
  assert.match(service, /herbyBotOutboxService/);
  assert.match(service, /deliveryMode: 'herbybot_outbox'/);
});

test('HerbyBot integration reuses an existing client and never logs in itself', () => {
  const bridge = read('integration/herbyBotBridge.js');
  assert.match(bridge, /Existing HerbyBot Discord client is required/);
  assert.equal(/new\s+Client\s*\(/.test(bridge), false);
  assert.equal(/\.login\s*\(/.test(bridge), false);
});
