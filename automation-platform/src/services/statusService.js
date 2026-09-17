const { fetchServerStatus } = require('../adapters/evrimaRcon');

const CACHE_MS = 10_000;
let cachedAt = 0;
let cachedServer = null;
let cachedError = null;

function configured(name) {
  return Boolean(String(process.env[name] || '').trim());
}

function integrationConfig() {
  return {
    rcon: configured('EVRIMA_RCON_HOST') && configured('EVRIMA_RCON_PORT') && configured('EVRIMA_RCON_PASSWORD'),
    commandBridge: configured('GAME_FTP_HOST') && configured('GAME_FTP_USER') && configured('GAME_FTP_PASSWORD') && configured('COMMAND_BRIDGE_INBOX_PATH'),
    discord: configured('DISCORD_BOT_TOKEN'),
    database: configured('DATABASE_URL'),
  };
}

async function getServerSnapshot({ force = false } = {}) {
  const integrations = integrationConfig();
  if (!integrations.rcon) {
    return { online: false, configured: false, players: [], characters: [], maxPlayers: null, error: null };
  }

  const now = Date.now();
  if (!force && cachedServer && now - cachedAt < CACHE_MS) {
    return { ...cachedServer, configured: true, cached: true, error: cachedError };
  }

  try {
    const result = await fetchServerStatus({
      host: process.env.EVRIMA_RCON_HOST,
      port: Number(process.env.EVRIMA_RCON_PORT),
      password: process.env.EVRIMA_RCON_PASSWORD,
      timeoutMs: Number(process.env.EVRIMA_RCON_TIMEOUT_MS || 6000),
    });
    cachedAt = Date.now();
    cachedError = null;
    cachedServer = {
      online: true,
      players: result.players,
      characters: result.characters,
      maxPlayers: result.maxPlayers,
      checkedAt: new Date(cachedAt).toISOString(),
    };
    return { ...cachedServer, configured: true, cached: false, error: null };
  } catch (error) {
    cachedAt = Date.now();
    cachedError = error.message;
    cachedServer = {
      online: false,
      players: [],
      characters: [],
      maxPlayers: null,
      checkedAt: new Date(cachedAt).toISOString(),
    };
    return { ...cachedServer, configured: true, cached: false, error: cachedError };
  }
}

async function getPlatformStatus(options = {}) {
  const integrations = integrationConfig();
  const server = await getServerSnapshot(options);
  return {
    ok: true,
    service: 'hollow-valley-automation-platform',
    time: new Date().toISOString(),
    integrations,
    server: {
      online: server.online,
      configured: server.configured,
      playerCount: server.players.length,
      maxPlayers: server.maxPlayers,
      players: server.players.map(({ steamId, name }) => ({ steamId, name })),
      characters: server.characters,
      checkedAt: server.checkedAt || null,
      error: server.error || null,
    },
  };
}

module.exports = { getPlatformStatus };
