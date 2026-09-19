const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

const readiness = require('../src/services/migrationReadinessService');
const bridge = require('../src/services/commandBridgeService');

const MANAGED = [
  'AUTOMATION_ADMIN_TOKEN', 'HOLLOW_VALLEY_API_TOKEN', 'AUTOMATION_DB_PATH',
  'RCON_HOST', 'RCON_PORT', 'RCON_PASSWORD', 'RCON_WRITE_ENABLED', 'ADMIN_RESTORE_WRITE_ENABLED',
  'SFTP_HOST', 'SFTP_PORT', 'SFTP_USER', 'SFTP_PASSWORD', 'SFTP_BASE_PATH',
  'COMMAND_BRIDGE_ENABLED', 'COMMAND_BRIDGE_SINGLE_PUBLISHER_ACK',
  'PLAYER_PRESENCE_ENABLED', 'SERVER_MONITOR_ENABLED',
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
    RCON_HOST: '127.0.0.1',
    RCON_PORT: '7777',
    RCON_PASSWORD: 'rcon-secret',
    RCON_WRITE_ENABLED: 'false',
    ADMIN_RESTORE_WRITE_ENABLED: 'false',
    SFTP_HOST: 'ftp.example.test',
    SFTP_PORT: '21',
    SFTP_USER: 'user',
    SFTP_PASSWORD: 'pass',
    SFTP_BASE_PATH: '/',
    COMMAND_BRIDGE_ENABLED: 'false',
    PLAYER_PRESENCE_ENABLED: 'false',
    SERVER_MONITOR_ENABLED: 'false',
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

test('safe isolated deployment can be ready while CommandBridge migration remains locked', () => {
  withEnv(baseReadyEnv(), () => {
    const result = readiness.getMigrationReadiness();
    assert.equal(result.stage, 'isolated-ready');
    assert.equal(result.readyForIsolatedDeployment, true);
    assert.equal(result.readyForCommandBridgeMigration, false);
    const publisher = result.checks.find((item) => item.id === 'publisher');
    assert.equal(publisher.ready, false);
  });
});

test('migration-ready requires the exact sole-publisher acknowledgement', () => {
  withEnv({
    ...baseReadyEnv(),
    COMMAND_BRIDGE_ENABLED: 'true',
    COMMAND_BRIDGE_SINGLE_PUBLISHER_ACK: bridge.PUBLISHER_ACK,
  }, () => {
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


test('enabling admin restore uploads moves isolated readiness to attention', () => {
  withEnv({ ...baseReadyEnv(), ADMIN_RESTORE_WRITE_ENABLED: 'true' }, () => {
    const result = readiness.getMigrationReadiness();
    const check = result.checks.find((item) => item.id === 'admin-restore-writes');
    assert.equal(check.ready, false);
    assert.equal(result.stage, 'attention');
    assert.equal(result.readyForIsolatedDeployment, false);
  });
});
