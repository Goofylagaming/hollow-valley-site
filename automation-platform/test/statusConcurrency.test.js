const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AUTOMATION_DB_PATH = ':memory:';

function fixture() {
  const rconPath = require.resolve('../src/adapters/evrimaRcon');
  const statusPath = require.resolve('../src/services/statusService');
  const originalRcon = require(rconPath);
  const previous = {
    RCON_HOST: process.env.RCON_HOST,
    RCON_PORT: process.env.RCON_PORT,
    RCON_PASSWORD: process.env.RCON_PASSWORD,
    RCON_STATUS_CACHE_MS: process.env.RCON_STATUS_CACHE_MS,
    RCON_DISABLED: process.env.RCON_DISABLED,
  };
  process.env.RCON_HOST = '127.0.0.1';
  process.env.RCON_PORT = '7777';
  process.env.RCON_PASSWORD = 'test-secret';
  process.env.RCON_STATUS_CACHE_MS = '55000';
  process.env.RCON_DISABLED = 'false';

  let calls = 0;
  require.cache[rconPath].exports = {
    ...originalRcon,
    async fetchServerStatus() {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 25));
      return {
        players: [{ steamId: '76561198000000001', name: 'Test' }],
        characters: [{
          steamId: '76561198000000001',
          name: 'Test',
          species: 'Carnotaurus',
          growth: 0.4,
          location: { x: 1, y: 2, z: 3 },
        }],
        maxPlayers: 100,
      };
    },
  };

  delete require.cache[statusPath];
  const service = require(statusPath);

  return {
    service,
    calls: () => calls,
    restore() {
      require.cache[rconPath].exports = originalRcon;
      delete require.cache[statusPath];
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}

test('concurrent forced status refreshes share one in-flight RCON request', async (t) => {
  const f = fixture();
  t.after(f.restore);

  const results = await Promise.all([
    f.service.getServerSnapshot({ force: true }),
    f.service.getServerSnapshot({ force: true }),
    f.service.getServerSnapshot({ force: true }),
  ]);

  assert.equal(f.calls(), 1);
  assert.ok(results.every((result) => result.online === true));
  assert.ok(results.every((result) => result.characters[0].species === 'Carnotaurus'));
});

test('ordinary read-only status calls reuse the recent cache', async (t) => {
  const f = fixture();
  t.after(f.restore);

  const fresh = await f.service.getServerSnapshot({ force: true });
  const cached = await f.service.getServerSnapshot();

  assert.equal(f.calls(), 1);
  assert.equal(fresh.online, true);
  assert.equal(cached.online, true);
  assert.equal(cached.cached, true);
});


test('RCON_DISABLED blocks status reads without opening RCON', async (t) => {
  const f = fixture();
  t.after(f.restore);
  process.env.RCON_DISABLED = 'true';

  const result = await f.service.getServerSnapshot({ force: true });

  assert.equal(f.calls(), 0);
  assert.equal(result.configured, false);
  assert.equal(result.online, false);
});

test('default minute-scale cache avoids extra routine player-list reads', async (t) => {
  const f = fixture();
  t.after(f.restore);

  await f.service.getServerSnapshot({ force: true });
  await f.service.getServerSnapshot();
  await f.service.getServerSnapshot();

  assert.equal(f.calls(), 1);
});
