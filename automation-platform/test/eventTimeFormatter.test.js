const test = require('node:test');
const assert = require('node:assert/strict');
const { formatEventTimeQld, QLD_TIME_ZONE } = require('../src/services/eventTimeFormatter');

test('Random Event messages use exact 01-11-2026 12:01 Queensland time format', () => {
  assert.equal(QLD_TIME_ZONE, 'Australia/Brisbane');
  assert.equal(
    formatEventTimeQld('2026-11-01T02:01:00.000Z'),
    '01-11-2026 12:01 (QLD time)'
  );
});

test('QLD times never use Sydney daylight saving or Render UTC timezone', () => {
  assert.equal(formatEventTimeQld('2026-01-01T00:05:00Z'), '01-01-2026 10:05 (QLD time)');
  assert.equal(formatEventTimeQld('2026-12-31T16:31:00Z'), '01-01-2027 02:31 (QLD time)');
  assert.equal(formatEventTimeQld('2026-07-01T00:05:00Z'), '01-07-2026 10:05 (QLD time)');
  assert.equal(formatEventTimeQld(Date.parse('2026-11-01T02:01:00Z')), '01-11-2026 12:01 (QLD time)');
});

test('invalid timestamps cannot be announced as valid times', () => {
  assert.throws(() => formatEventTimeQld('not-a-time'), /Valid event timestamp required/);
  assert.throws(() => formatEventTimeQld(NaN), /Valid event timestamp required/);
});
