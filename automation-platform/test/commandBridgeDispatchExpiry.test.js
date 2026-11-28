const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'command-bridge-expiry-'));
process.env.AUTOMATION_DB_PATH = path.join(dir, 'automation.sqlite');
process.env.GAME_ACTION_QUEUE_ENABLED = 'true';
process.env.GAME_ACTION_QUEUE_COOLDOWN_MS = '0';
process.env.GAME_ACTION_QUEUE_LOCK_TIMEOUT_MS = '60000';
process.env.COMMAND_BRIDGE_TRANSPORT = 'http_pull';
process.env.COMMAND_BRIDGE_HTTP_RESULT_FTP_FALLBACK = 'false';
process.env.COMMAND_BRIDGE_ENABLED = 'true';
process.env.COMMAND_BRIDGE_SINGLE_PUBLISHER_ACK = 'automation-platform-is-sole-publisher';
process.env.BINARYLANE_COMMAND_TOKEN = 'test-only-command-token';
process.env.VALLEY_ARCADE_DINO_DELIVERY_ENABLED = '1';

const http = require('../src/services/commandBridgeHttpService');
const bridge = require('../src/services/commandBridgeService');
const delivery = require('../src/services/arcadeDinoDelivery');
const economy = require('../src/services/economyStore');

const steam = '76561198000000031';
const daySeconds = 24 * 60 * 60;
delivery.schema();

function openSide() {
  const db = new DatabaseSync(process.env.AUTOMATION_DB_PATH);
  db.exec('PRAGMA busy_timeout = 5000;');
  return db;
}

function withSide(fn) {
  const db = openSide();
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function command(id, verb, ts = Math.floor(Date.now() / 1000)) {
  return {
    id,
    ts,
    verb,
    steam,
    args: { args: [] },
  };
}

function insertPending(row) {
  withSide((db) => {
    db.prepare(`
      INSERT INTO command_bridge_http_requests
        (id, verb, steam, expected_source, payload, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', datetime('now', ?))
    `).run(
      row.id,
      row.verb,
      row.steam || steam,
      row.source,
      JSON.stringify(row.command),
      row.createdModifier || '-3 days',
    );
  });
}

function quarantinePending() {
  withSide((db) => {
    db.prepare(`
      UPDATE command_bridge_http_requests
      SET status = 'completed',
          result_json = '{"ok":true,"msg":"test-quarantine","source":"DinoStorage"}',
          completed_at = datetime('now', '-1 day')
      WHERE status = 'pending'
    `).run();
    db.prepare(`
      UPDATE command_bridge_http_requests
      SET status = 'completed',
          result_json = '{"ok":true,"msg":"test-release","source":"DinoStorage"}',
          completed_at = datetime('now', '-1 day')
      WHERE status IN ('dispatched', 'acknowledged')
    `).run();
  });
}

function backdateRealCompletions() {
  withSide((db) => {
    db.prepare(`
      UPDATE command_bridge_http_requests
      SET completed_at = datetime('now', '-1 day')
      WHERE status = 'completed'
        AND COALESCE(json_extract(result_json, '$.error'), '') != ?
    `).run(http.EXPIRED_BEFORE_DISPATCH);
  });
}

function backdatePayloadTs(id, ts) {
  withSide((db) => {
    const row = db.prepare('SELECT payload FROM command_bridge_http_requests WHERE id = ?').get(id);
    const payload = JSON.parse(row.payload);
    payload.ts = ts;
    db.prepare('UPDATE command_bridge_http_requests SET payload = ? WHERE id = ?').run(JSON.stringify(payload), id);
  });
}

function captureLog(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => {
    lines.push(args.map((part) => String(part)).join(' '));
  };
  try {
    const value = fn();
    return { value, lines };
  } finally {
    console.log = original;
  }
}

test.describe('command bridge dispatch expiry', { concurrency: false }, () => {
  test('dispatch max age is configurable and clamped', () => {
    const previous = process.env.COMMAND_BRIDGE_DISPATCH_MAX_AGE_SECONDS;
    try {
      delete process.env.COMMAND_BRIDGE_DISPATCH_MAX_AGE_SECONDS;
      assert.equal(http.dispatchMaxAgeSeconds(), 90);
      process.env.COMMAND_BRIDGE_DISPATCH_MAX_AGE_SECONDS = '120';
      assert.equal(http.dispatchMaxAgeSeconds(), 120);
      process.env.COMMAND_BRIDGE_DISPATCH_MAX_AGE_SECONDS = '1';
      assert.equal(http.dispatchMaxAgeSeconds(), 30);
      process.env.COMMAND_BRIDGE_DISPATCH_MAX_AGE_SECONDS = '99999';
      assert.equal(http.dispatchMaxAgeSeconds(), 600);
      process.env.COMMAND_BRIDGE_DISPATCH_MAX_AGE_SECONDS = 'nope';
      assert.equal(http.dispatchMaxAgeSeconds(), 90);
    } finally {
      if (previous === undefined) delete process.env.COMMAND_BRIDGE_DISPATCH_MAX_AGE_SECONDS;
      else process.env.COMMAND_BRIDGE_DISPATCH_MAX_AGE_SECONDS = previous;
    }
  });

  test('a large expired backlog is closed on the first poll and the fresh command is dispatched', async () => {
    quarantinePending();
    const backlog = 2000;
    const oldTs = Math.floor(Date.now() / 1000) - (3 * daySeconds);
    const named = [
      ['expired-dino-list', 'dino_list', 'DinoStorage'],
      ['expired-dino-grant', 'dino_grant', 'DinoStorage'],
      ['expired-bd', 'bd', 'BodyDrop'],
      ['expired-admin', 'admin_slay', 'AdminActions'],
    ];
    withSide((db) => {
      const insert = db.prepare(`
        INSERT INTO command_bridge_http_requests
          (id, verb, steam, expected_source, payload, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'pending', datetime('now', '-3 days'))
      `);
      db.exec('BEGIN');
      try {
        for (const [id, verb, source] of named) {
          insert.run(id, verb, steam, source, JSON.stringify(command(id, verb, oldTs)));
        }
        for (let index = 0; index < backlog; index += 1) {
          const id = `expired-bulk-${index}`;
          const verb = index % 2 === 0 ? 'dino_grant' : 'dino_list';
          insert.run(id, verb, steam, 'DinoStorage', JSON.stringify(command(id, verb, oldTs + index)));
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    });

    const fresh = command('fresh-during-backlog', 'dino_list');
    http.enqueue(fresh, 'DinoStorage');
    const before = http.getSummary();

    const { value: claimedRaw, lines } = captureLog(() => http.claimPending(10));
    const claimed = claimedRaw.map(JSON.parse);

    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].id, fresh.id);
    assert.deepEqual(lines, [
      `[command-bridge] expired ${backlog + named.length} pending command(s) before dispatch`,
    ]);

    const after = http.getSummary();
    assert.equal(after.pending, 0);
    assert.equal(after.pending, before.pending - (backlog + named.length + 1));
    assert.equal(after.dispatched, before.dispatched + 1);
    assert.equal(after.completed, before.completed + backlog + named.length);
    assert.equal(http.getRequest(fresh.id).status, 'dispatched');

    const state = http.actionQueueState();
    assert.equal(state.reason, 'action_in_flight');
    assert.equal(state.active.id, fresh.id);
    if (state.lastCompleted) {
      assert.equal(String(state.lastCompleted.id).startsWith('expired-'), false);
      assert.ok(state.lastCompleted.ageMs > 2000);
    }
    assert.deepEqual(http.claimPending(10), []);

    for (const [id, verb, source] of named) {
      const row = http.getRequest(id);
      const result = JSON.parse(row.result_json);
      assert.equal(row.status, 'completed');
      assert.equal(row.dispatched_at, null);
      assert.equal(typeof result.ok, 'boolean');
      assert.equal(result.ok, false);
      assert.equal(result.error, http.EXPIRED_BEFORE_DISPATCH);
      assert.equal(result.msg, http.EXPIRED_BEFORE_DISPATCH);
      assert.equal(result.source, source);
      assert.equal(result.id, id);
      assert.equal(result.steam, steam);

      const outcome = await bridge.readOutcome(command(id, verb, oldTs));
      assert.equal(outcome.state, 'failed');
      assert.equal(outcome.ok, false);
      assert.equal(outcome.message, http.EXPIRED_BEFORE_DISPATCH);
      assert.equal(outcome.source, source);
    }

    const grant = JSON.parse(http.getRequest('expired-dino-grant').result_json);
    assert.equal(
      /target slot contains another|invalid (?:slot|class|growth)|order mismatch|another dinosaur/i.test(grant.msg),
      false,
    );
  });

  test('a fresh command is dispatched normally', () => {
    quarantinePending();
    const fresh = command('fresh-only', 'dino_list');
    http.enqueue(fresh, 'DinoStorage');
    const { value: claimedRaw, lines } = captureLog(() => http.claimPending(10));
    const claimed = claimedRaw.map(JSON.parse);
    assert.deepEqual(lines, []);
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].id, fresh.id);
    const row = http.getRequest(fresh.id);
    assert.equal(row.status, 'dispatched');
    assert.equal(row.result_json, null);
    assert.ok(row.dispatched_at);
  });

  test('a command still inside the max age is dispatched, and one past the clamped age is not', () => {
    quarantinePending();
    const previous = process.env.COMMAND_BRIDGE_DISPATCH_MAX_AGE_SECONDS;
    process.env.COMMAND_BRIDGE_DISPATCH_MAX_AGE_SECONDS = '1';
    try {
      assert.equal(http.dispatchMaxAgeSeconds(), 30);
      const now = Math.floor(Date.now() / 1000);
      const stale = command('age-stale', 'dino_list', now - 31);
      const young = command('age-young', 'bd', now - 5);
      http.enqueue(stale, 'DinoStorage');
      http.enqueue(young, 'BodyDrop');
      const claimed = http.claimPending(10).map(JSON.parse);
      assert.equal(claimed.length, 1);
      assert.equal(claimed[0].id, young.id);
      const expired = http.getRequest(stale.id);
      assert.equal(expired.status, 'completed');
      assert.equal(expired.dispatched_at, null);
      assert.equal(JSON.parse(expired.result_json).error, http.EXPIRED_BEFORE_DISPATCH);
    } finally {
      if (previous === undefined) delete process.env.COMMAND_BRIDGE_DISPATCH_MAX_AGE_SECONDS;
      else process.env.COMMAND_BRIDGE_DISPATCH_MAX_AGE_SECONDS = previous;
    }
  });

  test('rows with no payload timestamp use created_at', () => {
    quarantinePending();
    insertPending({
      id: 'no-ts-old',
      verb: 'dino_list',
      source: 'DinoStorage',
      createdModifier: '-2 days',
      command: { id: 'no-ts-old', verb: 'dino_list', steam, args: { args: [] } },
    });
    insertPending({
      id: 'no-ts-young',
      verb: 'dino_list',
      source: 'DinoStorage',
      createdModifier: '-1 seconds',
      command: { id: 'no-ts-young', verb: 'dino_list', steam, args: { args: [] } },
    });
    const claimed = http.claimPending(10).map(JSON.parse);
    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].id, 'no-ts-young');
    const expired = http.getRequest('no-ts-old');
    assert.equal(expired.status, 'completed');
    assert.equal(JSON.parse(expired.result_json).error, http.EXPIRED_BEFORE_DISPATCH);
  });

  test('an already dispatched command is not expired or sent again', () => {
    quarantinePending();
    const inflight = command('already-dispatched', 'dino_grant');
    http.enqueue(inflight, 'DinoStorage');
    assert.equal(http.claimPending(10).map(JSON.parse)[0].id, inflight.id);
    backdatePayloadTs(inflight.id, Math.floor(Date.now() / 1000) - (3 * daySeconds));
    const fresh = command('after-inflight', 'dino_list');
    http.enqueue(fresh, 'DinoStorage');
    assert.deepEqual(http.claimPending(10), []);
    const row = http.getRequest(inflight.id);
    assert.equal(row.status, 'dispatched');
    assert.equal(row.result_json, null);
    assert.equal(http.getRequest(fresh.id).status, 'pending');
  });

  test('cooldown still applies between real completions and expired rows do not start or bypass it', () => {
    quarantinePending();
    backdateRealCompletions();
    const previous = process.env.GAME_ACTION_QUEUE_COOLDOWN_MS;
    process.env.GAME_ACTION_QUEUE_COOLDOWN_MS = '10000';
    try {
      const first = command('cooldown-first', 'dino_store');
      const second = command('cooldown-second', 'bd');
      http.enqueue(first, 'DinoStorage');
      http.enqueue(second, 'BodyDrop');

      const claimed = http.claimPending(10).map(JSON.parse);
      assert.equal(claimed.length, 1);
      assert.equal(claimed[0].id, first.id);

      const outcome = http.acceptResult({
        id: first.id,
        steam,
        source: 'DinoStorage',
        ok: true,
        msg: 'park complete',
      });
      assert.equal(outcome.final, true);

      insertPending({
        id: 'cooldown-expired',
        verb: 'dino_grant',
        source: 'DinoStorage',
        createdModifier: '-3 days',
        command: command('cooldown-expired', 'dino_grant', Math.floor(Date.now() / 1000) - (3 * daySeconds)),
      });

      const { value: duringCooldown, lines } = captureLog(() => http.claimPending(10));
      assert.deepEqual(duringCooldown, []);
      assert.deepEqual(lines, ['[command-bridge] expired 1 pending command(s) before dispatch']);
      assert.equal(http.getRequest(second.id).status, 'pending');
      assert.equal(http.getRequest('cooldown-expired').status, 'completed');
      assert.equal(JSON.parse(http.getRequest('cooldown-expired').result_json).ok, false);

      const state = http.actionQueueState();
      assert.equal(state.locked, true);
      assert.equal(state.reason, 'cooldown');
      assert.equal(state.lastCompleted.id, first.id);
      assert.ok(state.lastCompleted.ageMs < 10000);
    } finally {
      process.env.GAME_ACTION_QUEUE_COOLDOWN_MS = previous === undefined ? '0' : previous;
    }
  });

  test('with the action queue disabled, expired commands are still withheld from the batch', () => {
    quarantinePending();
    const previous = process.env.GAME_ACTION_QUEUE_ENABLED;
    process.env.GAME_ACTION_QUEUE_ENABLED = 'false';
    try {
      const now = Math.floor(Date.now() / 1000);
      insertPending({
        id: 'batch-expired',
        verb: 'dino_store',
        source: 'DinoStorage',
        createdModifier: '-3 days',
        command: command('batch-expired', 'dino_store', now - (3 * daySeconds)),
      });
      const first = command('batch-fresh-1', 'dino_list', now);
      const second = command('batch-fresh-2', 'bd', now);
      http.enqueue(first, 'DinoStorage');
      http.enqueue(second, 'BodyDrop');
      const claimed = http.claimPending(10).map(JSON.parse);
      assert.deepEqual(claimed.map((entry) => entry.id), [first.id, second.id]);
      assert.equal(http.getRequest('batch-expired').status, 'completed');
      assert.equal(http.getRequest('batch-expired').dispatched_at, null);
    } finally {
      process.env.GAME_ACTION_QUEUE_ENABLED = previous === undefined ? 'true' : previous;
    }
  });

  test('an expired arcade grant is a failed delivery and is not granted again', async () => {
    quarantinePending();
    const row = {
      id: randomUUID(),
      steam_id: steam,
      reward_json: JSON.stringify({ type: 'dinosaur', species: 'omniraptor', growthPercent: 25 }),
      created_at: Date.now(),
      status: 'ready',
    };
    economy.db.prepare(
      'INSERT INTO arcade_entitlements(id,steam_id,reward_json,created_at) VALUES (?,?,?,?)',
    ).run(row.id, row.steam_id, row.reward_json, row.created_at);

    await delivery.deliver(row);
    const progress = economy.db.prepare(
      'SELECT * FROM arcade_dino_deliveries WHERE entitlement_id = ?',
    ).get(row.id);
    const queued = JSON.parse(progress.command_json);
    const grants = () => economy.db.prepare(
      "SELECT count(*) AS n FROM command_bridge_http_requests WHERE verb = 'dino_grant'",
    ).get().n;
    const before = grants();
    assert.equal(progress.status, 'queued');
    assert.equal(before >= 1, true);

    backdatePayloadTs(queued.id, Math.floor(Date.now() / 1000) - (3 * daySeconds));
    assert.deepEqual(http.claimPending(10), []);
    await delivery.deliver(row);
    await delivery.deliver(row);

    const after = economy.db.prepare(
      'SELECT status, message FROM arcade_dino_deliveries WHERE entitlement_id = ?',
    ).get(row.id);
    assert.equal(after.status, 'failed');
    assert.match(after.message, /admin review/);
    assert.equal(
      economy.db.prepare('SELECT status FROM arcade_entitlements WHERE id = ?').get(row.id).status,
      'ready',
    );
    assert.equal(grants(), before);
    const stored = http.getRequest(queued.id);
    assert.equal(stored.status, 'completed');
    assert.equal(stored.dispatched_at, null);
    assert.equal(JSON.parse(stored.result_json).ok, false);
  });

  test('the poll route returns the fresh command and does not arm death suppression for expired stores', async () => {
    quarantinePending();
    const oldTs = Math.floor(Date.now() / 1000) - (3 * daySeconds);
    insertPending({
      id: 'poll-expired-store',
      verb: 'dino_store',
      source: 'DinoStorage',
      createdModifier: '-3 days',
      command: command('poll-expired-store', 'dino_store', oldTs),
    });
    const fresh = command('poll-fresh', 'dino_list');
    http.enqueue(fresh, 'DinoStorage');

    const { app } = require('../src/index');
    const server = await new Promise((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    try {
      const address = server.address();
      const response = await fetch(`http://127.0.0.1:${address.port}/api/command-bridge/poll`, {
        headers: { Authorization: `Bearer ${process.env.BINARYLANE_COMMAND_TOKEN}` },
      });
      assert.equal(response.status, 200);
      const body = await response.text();
      assert.equal(body.trim(), JSON.stringify(fresh));
      assert.equal(body.includes('poll-expired-store'), false);
      const suppression = withSide((db) => db.prepare(
        'SELECT count(*) AS n FROM combat_death_suppressions WHERE request_id = ?',
      ).get('poll-expired-store'));
      assert.equal(suppression.n, 0);
      assert.equal(http.getRequest('poll-expired-store').status, 'completed');
      assert.equal(http.getRequest(fresh.id).status, 'dispatched');
    } finally {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
