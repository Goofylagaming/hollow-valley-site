const { fetchServerStatus } = require('../adapters/evrimaRcon');
const fileBridge = require('../adapters/fileBridge');
const { PUBLISHER_ACK } = require('./commandBridgeService');
const store = require('./automationStore');

function cacheMs() {
  const value = Number(process.env.RCON_STATUS_CACHE_MS || 55000);
  return Math.max(15000, Math.min(120000, Number.isFinite(value) ? value : 55000));
}

let cachedAt = 0;
let cachedServer = null;
let cachedError = null;
let inFlight = null;

function configured(name) {
  return Boolean(String(process.env[name] || '').trim());
}

function commandBridgePublisherReady() {
  return process.env.COMMAND_BRIDGE_ENABLED === 'true' &&
    String(process.env.COMMAND_BRIDGE_SINGLE_PUBLISHER_ACK || '').trim() === PUBLISHER_ACK;
}

function integrationConfig() {
  return {
    rcon: configured('RCON_HOST') && configured('RCON_PORT') && configured('RCON_PASSWORD'),
    commandBridge: commandBridgePublisherReady() && configured('SFTP_HOST') && configured('SFTP_PORT') && configured('SFTP_USER') && configured('SFTP_PASSWORD') && configured('SFTP_BASE_PATH'),
    discord: configured('HERBYBOT_AUTOMATION_TOKEN'),
    herbyBot: configured('HERBYBOT_AUTOMATION_TOKEN'),
    database: true,
  };
}

async function getServerSnapshot({ force = false } = {}) {
  const integrations = integrationConfig();
  if (!integrations.rcon) {
    return { online: false, configured: false, players: [], characters: [], maxPlayers: null, error: null };
  }

  const now = Date.now();
  if (!force && cachedServer && now - cachedAt < cacheMs()) {
    return { ...cachedServer, configured: true, cached: true, error: cachedError };
  }

  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const result = await fetchServerStatus({
        host: process.env.RCON_HOST,
        port: Number(process.env.RCON_PORT),
        password: process.env.RCON_PASSWORD,
        timeoutMs: Number(process.env.RCON_TIMEOUT_MS || 6000),
        maxPlayersHint: Number(process.env.MAX_PLAYERS || 0) || null,
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
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

function moduleState() {
  return {
    serverStatus: true,
    bodyDrop: true,
    dinoStorage: true,
    discordAutomation: true,
  };
}

function requestSummary() {
  const requests = store.listRequests({ limit: 500 });
  const summary = {
    total: requests.length,
    pending: 0,
    confirmed: 0,
    failed: 0,
    unknown: 0,
    bodyDrop: 0,
    dinoStorage: 0,
  };
  for (const request of requests) {
    if (request.kind === 'bodydrop') summary.bodyDrop += 1;
    if (request.kind === 'dinostorage') summary.dinoStorage += 1;
    if (['preparing', 'queued', 'acknowledged'].includes(request.status)) summary.pending += 1;
    if (['confirmed', 'accepted'].includes(request.status)) summary.confirmed += 1;
    if (request.status === 'failed') summary.failed += 1;
    if (request.status === 'unknown') summary.unknown += 1;
  }
  return summary;
}

async function getPublicStatus(options = {}) {
  const integrations = integrationConfig();
  const server = await getServerSnapshot(options);
  return {
    ok: true,
    service: 'hollow-valley-automation-platform',
    time: new Date().toISOString(),
    integrations,
    modules: moduleState(),
    server: {
      online: server.online,
      configured: server.configured,
      playerCount: server.players.length,
      maxPlayers: server.maxPlayers,
      checkedAt: server.checkedAt || null,
      error: server.error ? 'Server status check failed' : null,
    },
  };
}

async function getAdminStatus(options = {}) {
  const integrations = integrationConfig();
  const server = await getServerSnapshot(options);
  const charactersBySteamId = new Map(server.characters.map((character) => [character.steamId, character]));
  const players = server.players.map(({ steamId, name }) => {
    const character = charactersBySteamId.get(steamId);
    return {
      steamId,
      name,
      species: character?.species || null,
      growth: Number.isFinite(character?.growth) ? character.growth : null,
      health: Number.isFinite(character?.health) ? character.health : null,
      stamina: Number.isFinite(character?.stamina) ? character.stamina : null,
      location: character?.location || null,
    };
  });

  const rawBridge = await fileBridge.getBridgeHealth();
  const publisherReady = commandBridgePublisherReady();
  const publisherAckRequired = process.env.COMMAND_BRIDGE_ENABLED === 'true' && !publisherReady;
  const bridge = {
    ...rawBridge,
    publisherReady,
    publisherAckRequired,
    error: publisherAckRequired
      ? 'Publishing locked: confirm the automation platform is the sole CommandBridge publisher before activation.'
      : rawBridge.error,
  };

  return {
    ok: true,
    service: 'hollow-valley-automation-platform',
    time: new Date().toISOString(),
    integrations,
    modules: moduleState(),
    requests: requestSummary(),
    bridge,
    server: {
      online: server.online,
      configured: server.configured,
      playerCount: players.length,
      maxPlayers: server.maxPlayers,
      players,
      checkedAt: server.checkedAt || null,
      error: server.error || null,
    },
  };
}

module.exports = {
  getPublicStatus,
  getAdminStatus,
  getServerSnapshot,
  integrationConfig,
  commandBridgePublisherReady,
  requestSummary,
};
