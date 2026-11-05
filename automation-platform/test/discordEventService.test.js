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
  require(storePath).close();
  delete require.cache[storePath];
  delete require.cache[servicePath];
  if (oldDb === undefined) delete process.env.AUTOMATION_DB_PATH; else process.env.AUTOMATION_DB_PATH = oldDb;
  if (oldStale === undefined) delete process.env.DISCORD_EVENTS_STALE_SECONDS; else process.env.DISCORD_EVENTS_STALE_SECONDS = oldStale;
  const target = path.resolve(dir);
  assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(target, { recursive: true, force: true });
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
  assert.equal(result.events[0].status, 'unknown');
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

test('website-deleted Discord events stay hidden across HerbyBot resyncs', () => {
  const guildId = '1540359454627725387';
  const hiddenId = '1540359454627725398';
  const keptId = '1540359454627725399';
  const snapshot = [
    { id: hiddenId, title: 'Hide Me', startTime: '2026-09-22T09:00:00Z' },
    { id: keptId, title: 'Keep Me', startTime: '2026-09-22T10:00:00Z' },
  ];

  service.syncEvents({ guildId, events: snapshot, syncedAt: '2026-09-21T09:00:01Z' });
  const deleted = service.hideEventFromWebsite(hiddenId);
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.duplicate, false);

  let current = service.getEvents({ nowMs: Date.parse('2026-09-21T09:01:00Z') });
  assert.deepEqual(current.events.map((event) => event.id), [keptId]);

  const resynced = service.syncEvents({
    guildId,
    events: snapshot,
    syncedAt: '2026-09-21T09:02:00Z',
  });
  assert.deepEqual(resynced.events.map((event) => event.id), [keptId]);

  current = service.getEvents({ nowMs: Date.parse('2026-09-21T09:03:00Z') });
  assert.deepEqual(current.events.map((event) => event.id), [keptId]);

  service.syncEvents({
    guildId,
    events: [{ id: keptId, title: 'Keep Me', startTime: '2026-09-22T10:00:00Z' }],
    syncedAt: '2026-09-21T09:04:00Z',
  });
  assert.throws(() => service.hideEventFromWebsite(hiddenId), (error) => error.code === 'DISCORD_EVENT_NOT_FOUND');
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

test('older or conflicting snapshots cannot restore a completed event to scheduled',()=>{
  const guildId='1540359454627725387',event={id:'1540359454627725400',title:'Lifecycle event',startTime:'2026-09-22T09:00:00Z',endTime:'2026-09-22T10:00:00Z',status:'completed'};
  service.syncEvents({guildId,events:[event],syncedAt:'2026-09-22T11:00:00Z'});
  const before=require(storePath).getState('discord:scheduled-events');
  for(const stamp of ['2026-09-22T10:59:00Z','2026-09-22T11:00:00Z'])assert.throws(()=>service.syncEvents({guildId,events:[{...event,status:'scheduled'}],syncedAt:stamp}),{status:409});
  assert.deepEqual(require(storePath).getState('discord:scheduled-events'),before);
});
test('exact retries preserve hidden events and do not renew snapshot freshness',()=>{
  const guildId='1540359454627725387',event={id:'1540359454627725401',title:'Hidden completed event',startTime:'2026-09-22T09:00:00Z',status:'completed'};
  const input={guildId,events:[event],syncedAt:'2026-09-22T12:00:00Z'};
  service.syncEvents(input);service.hideEventFromWebsite(event.id);const before=require(storePath).getState('discord:scheduled-events');
  const retry=service.syncEvents(input);assert.equal(retry.duplicate,true);assert.equal(retry.events.length,0);
  assert.deepEqual(require(storePath).getState('discord:scheduled-events'),before);
  assert.equal(service.getEvents({nowMs:Date.parse('2026-09-22T12:06:00Z')}).stale,true);
});
test('canonical equal-time retries ignore event order when schedules match',()=>{
  const guildId='1540359454627725387',a={id:'1540359454627725402',title:'A',startTime:'2026-09-23T09:00:00Z'},b={...a,id:'1540359454627725403',title:'B'};
  const syncedAt='2026-09-22T13:00:00Z';service.syncEvents({guildId,events:[a,b],syncedAt});
  assert.equal(service.syncEvents({guildId,events:[b,a],syncedAt}).duplicate,true);
});
test('future timestamps, mixed guilds and malformed completed schedules cannot replace accepted state',()=>{
  const before=require(storePath).getState('discord:scheduled-events'),guildId='1540359454627725387';
  assert.throws(()=>service.syncEvents({guildId,events:[],syncedAt:new Date(Date.now()+120000).toISOString()}),/future/);
  assert.throws(()=>service.syncEvents({guildId,events:[{id:'1540359454627725404',guildId:'1540359454627725999',title:'Wrong guild',startTime:'2026-09-23T09:00:00Z'}]}),/guild does not match/);
  assert.throws(()=>service.syncEvents({guildId,events:[{id:'1540359454627725404',title:'Invalid schedule',status:'completed',startTime:'2026-09-23T09:00:00Z',endTime:'2026-09-23T08:00:00Z'}]}),/precedes/);
  assert.deepEqual(require(storePath).getState('discord:scheduled-events'),before);
});
test('failed atomic state mutation rolls back value and leaves the store usable',()=>{
  const store=require(storePath),before=store.getState('discord:scheduled-events');
  assert.throws(()=>store.mutateState('discord:scheduled-events',()=>{store.setState('discord:scheduled-events',{broken:true});throw new Error('Interrupted mutation');}),/Interrupted/);
  assert.deepEqual(store.getState('discord:scheduled-events'),before);
  assert.equal(store.mutateState('discord:scheduled-events',()=>undefined).value.guildId,before.value.guildId);
});
