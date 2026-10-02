const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-combat-suppression-'));
process.env.AUTOMATION_DB_PATH = path.join(tempDir, 'automation.sqlite');

const suppression = require('../src/services/combatDeathSuppressionService');

const steam = '76561198038977506';
const otherSteam = '76561197998095210';
const base = Date.parse('2026-10-03T00:00:00.000Z');

function naturalEvent(id, offsetMs) {
  return {
    id,
    occurredAt: new Date(base + offsetMs).toISOString(),
    killerSteamId: null,
    victimSteamId: steam,
  };
}

test.after(() => {
  try { suppression._test.db.close(); } catch {}
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('DinoStorage parking suppresses exactly one matching natural death', () => {
  suppression.arm({
    requestId: 'store-request-1',
    steamId: steam,
    delaySeconds: 2,
    ttlSeconds: 30,
    nowMs: base,
  });

  // A genuine death before the expected deferred park/corpse transition still counts.
  assert.equal(suppression.consumeNaturalDeath(naturalEvent('combat-before-window', 1000)), null);

  const first = suppression.consumeNaturalDeath(naturalEvent('combat-parked-death', 6000));
  assert.ok(first);
  assert.equal(first.request_id, 'store-request-1');
  assert.equal(first.reason, 'dinostorage_store');
  assert.equal(first.replay, false);

  // The window is one-use; another distinct natural death is not hidden.
  assert.equal(suppression.consumeNaturalDeath(naturalEvent('combat-real-death', 8000)), null);
});

test('replayed parked death stays suppressed after the one-use window was consumed', () => {
  const replay = suppression.consumeNaturalDeath(naturalEvent('combat-parked-death', 6000));
  assert.ok(replay);
  assert.equal(replay.replay, true);

  // A semantic replay with a new event ID is also suppressed.
  const semanticReplay = suppression.consumeNaturalDeath(naturalEvent('combat-replayed-new-id', 6000));
  assert.ok(semanticReplay);
  assert.equal(semanticReplay.replay, true);
});

test('PvP deaths are never suppressed by a parking window', () => {
  suppression.arm({
    requestId: 'store-request-pvp',
    steamId: steam,
    delaySeconds: 0,
    ttlSeconds: 30,
    nowMs: base + 60000,
  });

  const pvp = suppression.consumeNaturalDeath({
    id: 'combat-pvp',
    occurredAt: new Date(base + 65000).toISOString(),
    killerSteamId: otherSteam,
    victimSteamId: steam,
  });
  assert.equal(pvp, null);
});

test('failed DinoStorage store can cancel its suppression window', () => {
  suppression.arm({
    requestId: 'store-request-failed',
    steamId: steam,
    delaySeconds: 0,
    ttlSeconds: 30,
    nowMs: base + 120000,
  });
  assert.equal(suppression.cancel('store-request-failed'), true);
  assert.equal(
    suppression.consumeNaturalDeath(naturalEvent('combat-after-failed-store', 125000)),
    null
  );
});
