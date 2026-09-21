const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-discord-events-'));
const oldDb = process.env.AUTOMATION_DB_PATH;
const oldStale = process.env.DISCORD_EVENTS_STALE_SECONDS;
process.env.AUTOMATION_DB_PATH = path.join(dir, 'automation.sqlite');
process.env.DISCORD_EVENTS_STALE_SECONDS = '300';

const storePath = require.resolve('../src/services/automationStore');
const servicePath = require.resolve('../src/services/discordEventService');
delete require.cache[storePath];
delete require.cache[servicePath];

const service = require(servicePath);

test.after(() => {
  delete require.cache[storePath];
  delete require.cache[servicePath];
  if (oldDb === undefined) delete process.env.AUTOMATION_DB_PATH; else process.env.AUTOMATION_DB_PATH = oldDb;
  if (oldStale === undefined) delete process.env.DISCORD_EVENTS_STALE_SECONDS; else process.env.DISCORD_EVENTS_STALE_SECONDS = oldStale;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Discord scheduled event snapshots persist and sort by start time', () => {
  const guildId = '1540359454627725387';
  const syncedAt = '2026-09-21T09:00:00.000Z';
  const result = service.syncEvents({
    guildId,
    syncedAt,
    events: [
      {
        id: '1540359454627725399',
        title: 'Later Event',
        description: 'Second',
        startTime: '2026-09-22T10:00:00+10:00',
        attendees: 8,
      },
      {
        id: '1540359454627725398',
        title: 'Earlier Event',
        description: 'First',
        startTime: '2026-09-22T09:00:00+10:00',
        location: 'Gateway',
        attendees: 12,
      },
    ],
  });

  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].title, 'Earlier Event');
  assert.equal(result.events[0].location, 'Gateway');
  assert.equal(result.events[0].attendees, 12);
  assert.equal(result.events[0].url, `https://discord.com/events/${guildId}/1540359454627725398`);

  const current = service.getEvents({ nowMs: Date.parse('2026-09-21T09:04:59.000Z') });
  assert.equal(current.configured, true);
  assert.equal(current.stale, false);
  assert.equal(current.events.length, 2);

  const stale = service.getEvents({ nowMs: Date.parse('2026-09-21T09:05:01.000Z') });
  assert.equal(stale.stale, true);
  assert.equal(stale.events.length, 2);
});

test('Discord event sync rejects duplicate IDs and malformed payloads', () => {
  const guildId = '1540359454627725387';
  assert.throws(() => service.syncEvents({
    guildId,
    events: [
      { id: '1540359454627725391', title: 'One', startTime: '2026-09-22T09:00:00Z' },
      { id: '1540359454627725391', title: 'Two', startTime: '2026-09-22T10:00:00Z' },
    ],
  }), /Duplicate scheduled event ID/);

  assert.throws(() => service.syncEvents({
    guildId: 'bad',
    events: [],
  }), /Guild ID must be a Discord snowflake/);
});
