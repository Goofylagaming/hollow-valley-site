const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

const readiness = require('../src/services/migrationReadinessService');
const bridge = require('../src/services/commandBridgeService');

const MANAGED = [
  'AUTOMATION_ADMIN_TOKEN', 'HOLLOW_VALLEY_API_TOKEN', 'AUTOMATION_DB_PATH',
  'RCON_WRITE_ENABLED', 'ADMIN_RESTORE_WRITE_ENABLED',
  'PRESENCE_FEED_TOKEN', 'COMMAND_BRIDGE_TRANSPORT', 'BINARYLANE_COMMAND_TOKEN',
  'COMMAND_BRIDGE_ENABLED', 'COMMAND_BRIDGE_SINGLE_PUBLISHER_ACK',
  'PLAYER_PRESENCE_ENABLED', 'SERVER_MONITOR_ENABLED',
  'WALLET_PLAYTIME_REWARDS_ENABLED', 'WALLET_PLAYTIME_COINS_PER_5_MINUTES',
  'MARKETPLACE_WRITE_ENABLED', 'OFFICIAL_MARKETPLACE_FULFILLMENT_ENABLED',
  'PARKED_DINO_EDIT_ENABLED', 'SKIN_SYSTEM_ENABLED',
];

function withEnv(values, fn) {
  const previous = Object.fromEntries(MANAGED.map((name) => [name, process.env[name]]));
  for (const name of MANAGED) delete process.env[name];
  for (const [name, value] of Object.entries(values)) process.env[name] = String(value);
  try { return fn(); } finally {
    for (const name of MANAGED) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
}

function baseReadyEnv() {
  return {
    AUTOMATION_ADMIN_TOKEN: 'admin-secret',
    HOLLOW_VALLEY_API_TOKEN: 'website-secret',
    AUTOMATION_DB_PATH: path.join(os.homedir(), 'hollow-valley', 'automation.sqlite'),
    RCON_WRITE_ENABLED: 'false',
    ADMIN_RESTORE_WRITE_ENABLED: 'false',
    PRESENCE_FEED_TOKEN: 'presence-secret',
    COMMAND_BRIDGE_TRANSPORT: 'http_pull',
    BINARYLANE_COMMAND_TOKEN: 'binarylane-command-secret',
    COMMAND_BRIDGE_ENABLED: 'false',
    PLAYER_PRESENCE_ENABLED: 'false',
    SERVER_MONITOR_ENABLED: 'false',
  };
}

function fullyReadyEnv() {
  return {
    ...baseReadyEnv(),
    COMMAND_BRIDGE_ENABLED: 'true',
    COMMAND_BRIDGE_SINGLE_PUBLISHER_ACK: bridge.PUBLISHER_ACK,
    WALLET_PLAYTIME_REWARDS_ENABLED: 'true',
    WALLET_PLAYTIME_COINS_PER_5_MINUTES: '50',
    MARKETPLACE_WRITE_ENABLED: 'true',
    OFFICIAL_MARKETPLACE_FULFILLMENT_ENABLED: 'true',
    PARKED_DINO_EDIT_ENABLED: 'true',
    SKIN_SYSTEM_ENABLED: 'true',
  };
}

test('incomplete configuration remains in setup stage', () => {
  withEnv({}, () => {
    const result = readiness.getMigrationReadiness();
    assert.equal(result.stage, 'setup');
    assert.equal(result.readyForIsolatedDeployment, false);
    assert.equal(result.readyForCommandBridgeMigration, false);
  });
});

test('configured integrations remain in attention until activation and write gates are enabled', () => {
  withEnv(baseReadyEnv(), () => {
    const result = readiness.getMigrationReadiness();
    assert.equal(result.stage, 'attention');
    assert.equal(result.readyForIsolatedDeployment, false);
    assert.equal(result.readyForCommandBridgeMigration, false);
    const publisher = result.checks.find((item) => item.id === 'publisher');
    assert.equal(publisher.ready, false);
    const bridgePublishing = result.checks.find((item) => item.id === 'bridge-off');
    assert.equal(bridgePublishing.ready, false);
  });
});

test('migration-ready requires the sole-publisher acknowledgement and all safety gates', () => {
  withEnv(fullyReadyEnv(), () => {
    const result = readiness.getMigrationReadiness();
    assert.equal(result.stage, 'migration-ready');
    assert.equal(result.readyForIsolatedDeployment, true);
    assert.equal(result.readyForCommandBridgeMigration, true);
  });
});

test('enabling CommandBridge without acknowledgement creates an attention state', () => {
  withEnv({ ...baseReadyEnv(), COMMAND_BRIDGE_ENABLED: 'true' }, () => {
    const result = readiness.getMigrationReadiness();
    assert.equal(result.stage, 'attention');
    assert.equal(result.readyForIsolatedDeployment, false);
    assert.equal(result.readyForCommandBridgeMigration, false);
  });
});


test('enabling admin restore uploads moves a migration-ready configuration to attention', () => {
  withEnv({ ...fullyReadyEnv(), ADMIN_RESTORE_WRITE_ENABLED: 'true' }, () => {
    const result = readiness.getMigrationReadiness();
    const check = result.checks.find((item) => item.id === 'admin-restore-writes');
    assert.equal(check.ready, false);
    assert.equal(result.stage, 'attention');
    assert.equal(result.readyForIsolatedDeployment, false);
  });
});
