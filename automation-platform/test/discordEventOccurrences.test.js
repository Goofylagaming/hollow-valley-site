const test = require('node:test');
const assert = require('node:assert/strict');

const events = require('../src/services/discordEventService');

const guildId = '123456789012345678';
const discordEventId = '987654321098765432';
const env = { EVENT_TIME_ZONE: 'Australia/Brisbane' };

test('same Discord event reused on a different Brisbane date gets a new occurrence ID', () => {
  const first = events.normalizeEvent({
    id: discordEventId,
    title: 'Friday Event',
    startTime: '2026-09-25T09:00:00.000Z',
  }, guildId, env);

  const second = events.normalizeEvent({
    id: discordEventId,
    title: 'Friday Event',
    startTime: '2026-10-02T09:00:00.000Z',
  }, guildId, env);

  assert.notEqual(first.id, second.id);
  assert.equal(first.discordEventId, discordEventId);
  assert.equal(second.discordEventId, discordEventId);
  assert.match(first.id, /^987654321098765432:\d{8}$/);
});

test('rescheduling within the same Brisbane date keeps the same occurrence ID', () => {
  const early = events.normalizeEvent({
    id: discordEventId,
    title: 'Friday Event',
    startTime: '2026-10-02T08:00:00.000Z',
  }, guildId, env);

  const later = events.normalizeEvent({
    id: discordEventId,
    title: 'Friday Event',
    startTime: '2026-10-02T11:30:00.000Z',
  }, guildId, env);

  assert.equal(early.id, later.id);
});

test('stored legacy snowflake IDs are upgraded to occurrence IDs when read', () => {
  const rows = events._test.normalizeStoredEvents([{
    id: discordEventId,
    guildId,
    title: 'Friday Event',
    startTime: '2026-10-02T09:00:00.000Z',
    attendees: 0,
  }], guildId, env);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].discordEventId, discordEventId);
  assert.match(rows[0].id, /^987654321098765432:\d{8}$/);
});
