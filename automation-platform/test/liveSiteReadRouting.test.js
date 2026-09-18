const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', '..', relativePath), 'utf8');
}

test('My Dinos reads and store/redeem writes use automation adapters', () => {
  const source = readRepoFile('server/routes/mydinos.js');

  assert.match(source, /router\.get\("\/", requireAuth, \(req, res\) => automationRoutes\.listDinos\(req, res\)\)/);
  assert.match(source, /automationRoutes\.getActiveCharacter\(req, res\)/);
  assert.match(source, /automationRoutes\.parkActive\(req, res\)/);
  assert.match(source, /automationRoutes\.redeemStored\(req, res, slot\)/);
  assert.doesNotMatch(source, /respondToDinoStorageAction/);
});

test('BodyDrop GET and POST both use automation and legacy executor is absent', () => {
  const source = readRepoFile('server/routes/bodydrop.js');

  assert.match(source, /automationRoutes\.getBodyDropState\(req, res, \{ options: getDropTypes\(\) \}\)/);
  assert.match(source, /automationRoutes\.requestBodyDrop\(req, res\)/);
  assert.doesNotMatch(source, /executeBodyDrop/);
  assert.doesNotMatch(source, /createBodyDropRequest/);
});

test('wallet, quests and marketplace branch routes use the automation adapters', () => {
  const wallet = readRepoFile('server/routes/wallet.js');
  const quests = readRepoFile('server/routes/quests.js');
  const marketplace = readRepoFile('server/routes/marketplace.js');

  assert.match(wallet, /automationRoutes\.getWallet/);
  assert.match(quests, /automationRoutes\.getQuests/);
  assert.match(marketplace, /automationRoutes\.listMarketplaceCatalog/);
  assert.match(marketplace, /automationRoutes\.listDinoMarketplaceListings/);
});
