const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', '..', relativePath), 'utf8');
}

test('My Dinos read routes use automation while store/redeem remain on legacy publisher', () => {
  const source = readRepoFile('server/routes/mydinos.js');

  assert.match(source, /router\.get\("\/", requireAuth, \(req, res\) => automationRoutes\.listDinos\(req, res\)\)/);
  assert.match(source, /automationRoutes\.getActiveCharacter\(req, res\)/);
  assert.match(source, /respondToDinoStorageAction\(req, res, "store", createSlotId\(\)\)/);
  assert.match(source, /respondToDinoStorageAction\(req, res, "redeem", slot\)/);
});

test('BodyDrop read route uses automation while POST remains on legacy publisher', () => {
  const source = readRepoFile('server/routes/bodydrop.js');

  assert.match(source, /automationRoutes\.getBodyDropState\(req, res, \{ options: getDropTypes\(\) \}\)/);
  assert.match(source, /router\.post\("\/", requireAuth/);
  assert.match(source, /executeBodyDrop\(/);
  assert.doesNotMatch(source, /router\.post\("\/", requireAuth[^]*automationRoutes\.requestBodyDrop/);
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
