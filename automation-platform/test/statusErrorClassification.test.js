const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AUTOMATION_DB_PATH = ':memory:';

const { classifyRconError } = require('../src/services/statusService');

test('RCON startup errors are reduced to safe diagnostic categories', () => {
  assert.equal(classifyRconError('RCON authentication failed'), 'authentication');
  assert.equal(classifyRconError('RCON response timeout'), 'response-timeout');
  assert.equal(classifyRconError('RCON connection timeout'), 'connection-timeout');
  assert.equal(classifyRconError('connect ECONNREFUSED 127.0.0.1:8888'), 'connection-refused');
  assert.equal(classifyRconError('connect EHOSTUNREACH 127.0.0.1:8888'), 'network-unreachable');
  assert.equal(classifyRconError('read ECONNRESET'), 'connection-reset');
  assert.equal(classifyRconError('getaddrinfo ENOTFOUND example.invalid'), 'dns');
  assert.equal(classifyRconError('unexpected protocol response'), 'other');
  assert.equal(classifyRconError(null), 'none');
});
