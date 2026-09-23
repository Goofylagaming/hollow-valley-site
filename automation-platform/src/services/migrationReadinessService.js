const path = require('node:path');
const { PUBLISHER_ACK } = require('./commandBridgeService');

function configured(name) {
  return Boolean(String(process.env[name] || '').trim());
}

function check(id, label, ready, detail, level = 'required') {
  return { id, label, ready: Boolean(ready), detail, level };
}

function getMigrationReadiness() {
  const dbPath = String(process.env.AUTOMATION_DB_PATH || '').trim();
  const dbPersistent = Boolean(dbPath) && dbPath !== ':memory:' && !path.resolve(dbPath).includes(`${path.sep}tmp${path.sep}`);
  const rconConfigured = configured('RCON_HOST') && configured('RCON_PORT') && configured('RCON_PASSWORD');
  const ftpConfigured = configured('SFTP_HOST') && configured('SFTP_PORT') && configured('SFTP_USER') && configured('SFTP_PASSWORD') && configured('SFTP_BASE_PATH');
  const bridgeTransport = String(process.env.COMMAND_BRIDGE_TRANSPORT || 'file').trim().toLowerCase();
  const binaryLaneHttpConfigured = configured('BINARYLANE_COMMAND_TOKEN');
  const bridgeTransportConfigured = bridgeTransport === 'http_pull'
    ? binaryLaneHttpConfigured
    : bridgeTransport === 'file'
      ? ftpConfigured
      : false;
  const bridgeEnabled = process.env.COMMAND_BRIDGE_ENABLED === 'true';
  const solePublisherAck = String(process.env.COMMAND_BRIDGE_SINGLE_PUBLISHER_ACK || '').trim() === PUBLISHER_ACK;
  const rconWritesEnabled = process.env.RCON_WRITE_ENABLED === 'true';
  const adminRestoreWritesEnabled = process.env.ADMIN_RESTORE_WRITE_ENABLED === 'true';
  const rconPresenceEnabled = process.env.PLAYER_PRESENCE_ENABLED === 'true';
  const externalPresenceConfigured = configured('PRESENCE_FEED_TOKEN');
  const presenceEnabled = rconPresenceEnabled || externalPresenceConfigured;
  const monitorEnabled = process.env.SERVER_MONITOR_ENABLED === 'true';
  const herbyBotConfigured = configured('HERBYBOT_AUTOMATION_TOKEN');
  const playtimeRewardsEnabled = process.env.WALLET_PLAYTIME_REWARDS_ENABLED === 'true';
  const playtimeRewardCoins = Number(process.env.WALLET_PLAYTIME_COINS_PER_5_MINUTES || 0);
  const playtimeRewardsSafe = !playtimeRewardsEnabled || (presenceEnabled && Number.isSafeInteger(playtimeRewardCoins) && playtimeRewardCoins > 0);
  const marketplaceWritesEnabled = process.env.MARKETPLACE_WRITE_ENABLED === 'true';
  const officialMarketplaceFulfillmentEnabled = process.env.OFFICIAL_MARKETPLACE_FULFILLMENT_ENABLED === 'true';
  const parkedDinoEditsEnabled = process.env.PARKED_DINO_EDIT_ENABLED === 'true';
  const skinSystemEnabled = process.env.SKIN_SYSTEM_ENABLED === 'true';

  const checks = [
    check('admin-token', 'Operator admin token', configured('AUTOMATION_ADMIN_TOKEN'), configured('AUTOMATION_ADMIN_TOKEN') ? 'Admin API is protected.' : 'Set AUTOMATION_ADMIN_TOKEN before exposing the operator console.'),
    check('website-token', 'Website integration token', configured('HOLLOW_VALLEY_API_TOKEN'), configured('HOLLOW_VALLEY_API_TOKEN') ? 'Separate server-to-server credential is configured.' : 'Set a dedicated HOLLOW_VALLEY_API_TOKEN before connecting the live website.'),
    check('database', 'Persistent automation database', dbPersistent, dbPersistent ? `Automation state uses ${dbPath}.` : 'Use a persistent disk path for AUTOMATION_DB_PATH; in-memory/temporary storage is not production-safe.'),
    check('rcon-read', 'Read-only Evrima RCON', rconConfigured, rconConfigured ? 'RCON credentials are configured.' : 'Add RCON_HOST, RCON_PORT and RCON_PASSWORD for server/player reads.'),
    check('bridge-transport', 'CommandBridge transport', bridgeTransportConfigured,
      bridgeTransport === 'http_pull'
        ? binaryLaneHttpConfigured
          ? 'BinaryLane outbound HTTPS command transport is configured.'
          : 'Set BINARYLANE_COMMAND_TOKEN for the BinaryLane HTTP pull bridge.'
        : bridgeTransport === 'file'
          ? ftpConfigured
            ? 'Legacy file transport is configured.'
            : 'Add SFTP_HOST/PORT/USER/PASSWORD/BASE_PATH for legacy file transport.'
          : 'COMMAND_BRIDGE_TRANSPORT must be file or http_pull.'),
    check('ftp', 'Legacy file access', ftpConfigured, ftpConfigured
      ? 'FTP credentials remain available for file-backed features.'
      : 'Optional for the BinaryLane command bridge; some parked-dino/file features still need a replacement transport.', 'optional'),
    check('bridge-off', 'CommandBridge writes remain gated', !bridgeEnabled || solePublisherAck, bridgeEnabled
      ? solePublisherAck
        ? 'CommandBridge is enabled and the sole-publisher migration acknowledgement is present.'
        : 'CommandBridge is enabled but publishing remains locked until sole-publisher acknowledgement is set.'
      : 'CommandBridge publishing is disabled, which is correct before migration.', 'safety'),
    check('publisher', 'Single CommandBridge publisher', solePublisherAck, solePublisherAck
      ? 'Automation platform is explicitly acknowledged as the sole publisher.'
      : 'Do not set the acknowledgement until the live website has stopped writing commands.ndjson.', 'activation'),
    check('rcon-writes', 'RCON writes remain disabled', !rconWritesEnabled, rconWritesEnabled
      ? 'RCON write actions are enabled. Only do this after read-only validation and controlled testing.'
      : 'RCON writes are disabled.', 'safety'),
    check('admin-restore-writes', 'Admin restore uploads remain disabled', !adminRestoreWritesEnabled, adminRestoreWritesEnabled
      ? 'Admin restore FTP uploads are enabled. Use only during a controlled operator restore window.'
      : 'Admin restore JSON can be built, but FTP slot uploads remain locked.', 'safety'),
    check('herbybot', 'HerbyBot automation bridge', herbyBotConfigured, herbyBotConfigured
      ? 'Dedicated HerbyBot server-to-server token is configured; Discord credentials remain on HerbyBot only.'
      : 'Optional: set HERBYBOT_AUTOMATION_TOKEN to enable durable announcements and alerts through the existing HerbyBot.', 'optional'),
    check('presence', 'Presence tracking', presenceEnabled, presenceEnabled
      ? externalPresenceConfigured && !rconPresenceEnabled
        ? 'BinaryLane external presence feed is configured; direct automation RCON polling can remain disabled.'
        : 'Read-only RCON session tracking is enabled.'
      : 'Optional: enable stable RCON polling or configure the dedicated BinaryLane presence feed.', 'optional'),
    check('playtime-rewards', 'Valley Coin playtime rewards', playtimeRewardsSafe, playtimeRewardsEnabled
      ? playtimeRewardsSafe
        ? `Rewards are enabled at ${playtimeRewardCoins} Valley Coin per verified 5 minutes.`
        : 'Rewards are enabled without both presence tracking and a positive integer coin rate. Disable rewards or complete the configuration.'
      : 'Playtime rewards are disabled, which is correct until the economy rate and presence sampling are approved.', 'safety'),
    check('marketplace-writes', 'Marketplace writes remain disabled', !marketplaceWritesEnabled, marketplaceWritesEnabled
      ? 'Marketplace buying/selling is enabled. Use only after wallet migration and DinoStorage escrow testing.'
      : 'Official and player-to-player marketplace writes are disabled.', 'safety'),
    check('official-marketplace-fulfillment', 'Official marketplace fulfillment remains disabled', !officialMarketplaceFulfillmentEnabled, officialMarketplaceFulfillmentEnabled
      ? 'Official catalog fulfillment is enabled and can create DinoStorage files. Use only after controlled FTP tests.'
      : 'Official catalog DinoStorage fulfillment is locked.', 'safety'),
    check('parked-dino-edits', 'Parked dino edits remain disabled', !parkedDinoEditsEnabled, parkedDinoEditsEnabled
      ? 'Mutation/skin writes to parked DinoStorage JSON are enabled.'
      : 'Parked dinosaur mutation/skin writes remain locked.', 'safety'),
    check('skin-system', 'Skin system remains disabled', !skinSystemEnabled, skinSystemEnabled
      ? 'Skin preset creation/application is enabled.'
      : 'Skin preset system is disabled until controlled validation.', 'safety'),
    check('monitor', 'Server outage monitoring', monitorEnabled, monitorEnabled ? 'Persistent outage/recovery monitoring is enabled and alerts are queued for HerbyBot.' : 'Optional: enable after the HerbyBot bridge and RCON stability are verified.', 'optional'),
  ];

  const required = checks.filter((item) => item.level === 'required');
  const safety = checks.filter((item) => item.level === 'safety');
  const activation = checks.filter((item) => item.level === 'activation');
  const requiredReady = required.filter((item) => item.ready).length;
  const safetyReady = safety.every((item) => item.ready);
  const activationReady = activation.every((item) => item.ready);

  return {
    stage: !required.every((item) => item.ready)
      ? 'setup'
      : !safetyReady
        ? 'attention'
        : !activationReady
          ? 'isolated-ready'
          : 'migration-ready',
    readyForIsolatedDeployment: required.every((item) => item.ready) && safetyReady,
    readyForCommandBridgeMigration: required.every((item) => item.ready) && safetyReady && activationReady && bridgeTransportConfigured,
    requiredReady,
    requiredTotal: required.length,
    checks,
  };
}

module.exports = { getMigrationReadiness };
