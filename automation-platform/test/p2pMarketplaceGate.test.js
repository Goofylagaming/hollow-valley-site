const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('individual dino selling inherits marketplace writes unless P2P gate explicitly overrides it', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-p2p-gate-'));
  const previous = {
    db: process.env.AUTOMATION_DB_PATH,
    write: process.env.MARKETPLACE_WRITE_ENABLED,
    p2pWrite: process.env.P2P_MARKETPLACE_WRITE_ENABLED,
  };

  process.env.AUTOMATION_DB_PATH = path.join(dir, 'economy.sqlite');
  process.env.MARKETPLACE_WRITE_ENABLED = 'true';
  delete process.env.P2P_MARKETPLACE_WRITE_ENABLED;

  const storePath = require.resolve('../src/services/economyStore');
  const servicePath = require.resolve('../src/services/dinoMarketplaceService');
  delete require.cache[storePath];
  delete require.cache[servicePath];
  const service = require(servicePath);

  t.after(() => {
    delete require.cache[storePath];
    delete require.cache[servicePath];
    if (previous.db === undefined) delete process.env.AUTOMATION_DB_PATH;
    else process.env.AUTOMATION_DB_PATH = previous.db;
    if (previous.write === undefined) delete process.env.MARKETPLACE_WRITE_ENABLED;
    else process.env.MARKETPLACE_WRITE_ENABLED = previous.write;
    if (previous.p2pWrite === undefined) delete process.env.P2P_MARKETPLACE_WRITE_ENABLED;
    else process.env.P2P_MARKETPLACE_WRITE_ENABLED = previous.p2pWrite;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  assert.equal(service.writeEnabled(), true);
  assert.equal(service.p2pWriteEnabled(), true, 'existing marketplace write gate should enable player selling');
  assert.doesNotThrow(() => service.assertWriteEnabled());

  process.env.P2P_MARKETPLACE_WRITE_ENABLED = 'false';
  assert.equal(service.p2pWriteEnabled(), false, 'explicit P2P false must override the fallback');
  assert.throws(
    () => service.assertWriteEnabled(),
    (error) => error?.code === 'MARKETPLACE_WRITE_DISABLED'
  );

  process.env.MARKETPLACE_WRITE_ENABLED = 'false';
  process.env.P2P_MARKETPLACE_WRITE_ENABLED = 'true';
  assert.equal(service.writeEnabled(), false);
  assert.equal(service.p2pWriteEnabled(), true, 'P2P can still be enabled independently when explicitly configured');
});
