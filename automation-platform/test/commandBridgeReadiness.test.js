const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AUTOMATION_DB_PATH = ':memory:';

const status = require('../src/services/statusService');
const bridge = require('../src/services/commandBridgeService');

function restore(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test('CommandBridge status is not ready until sole-publisher acknowledgement is present', (t) => {
  const names = [
    'COMMAND_BRIDGE_ENABLED',
    'COMMAND_BRIDGE_SINGLE_PUBLISHER_ACK',
    'SFTP_HOST',
    'SFTP_PORT',
    'SFTP_USER',
    'SFTP_PASSWORD',
    'SFTP_BASE_PATH',
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  t.after(() => names.forEach((name) => restore(name, previous[name])));

  process.env.COMMAND_BRIDGE_ENABLED = 'true';
  process.env.SFTP_HOST = 'ftp.example.test';
  process.env.SFTP_PORT = '21';
  process.env.SFTP_USER = 'user';
  process.env.SFTP_PASSWORD = 'pass';
  process.env.SFTP_BASE_PATH = '/';
  delete process.env.COMMAND_BRIDGE_SINGLE_PUBLISHER_ACK;

  assert.equal(status.commandBridgePublisherReady(), false);
  assert.equal(status.integrationConfig().commandBridge, false);

  process.env.COMMAND_BRIDGE_SINGLE_PUBLISHER_ACK = bridge.PUBLISHER_ACK;
  assert.equal(status.commandBridgePublisherReady(), true);
  assert.equal(status.integrationConfig().commandBridge, true);
});
