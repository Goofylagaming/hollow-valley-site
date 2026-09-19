const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', '..', relativePath), 'utf8');
}

test('My Dinos reads and store/redeem writes use the website automation client', () => {
  const source = readRepoFile('server/routes/mydinos.js');
  assert.match(source, /require\("\.\.\/services\/automationWebsiteClient"\)/);
  assert.match(source, /automation\.listStoredDinos/);
  assert.match(source, /automation\.getActiveCharacter/);
  assert.match(source, /automation\.requestDinoAction/);
  assert.doesNotMatch(source, /respondToDinoStorageAction/);
});

test('BodyDrop GET and POST use automation and the legacy executor is absent', () => {
  const source = readRepoFile('server/routes/bodydrop.js');
  assert.match(source, /automation\.getBodyDropCooldown/);
  assert.match(source, /automation\.requestBodyDrop/);
  assert.doesNotMatch(source, /executeBodyDrop/);
  assert.doesNotMatch(source, /createBodyDropRequest/);
});

test('wallet, quests and marketplace routes use the website automation client', () => {
  const wallet = readRepoFile('server/routes/wallet.js');
  const quests = readRepoFile('server/routes/quests.js');
  const marketplace = readRepoFile('server/routes/marketplace.js');
  assert.match(wallet, /automation\.getWallet/);
  assert.match(wallet, /automation\.getDailyLoginBonus/);
  assert.match(quests, /automation\.getQuests/);
  assert.match(marketplace, /automation\.listMarketplaceCatalog/);
  assert.match(marketplace, /automation\.listDinoMarketplaceListings/);
  assert.match(marketplace, /automation\.listMarketplaceOrders/);
});
