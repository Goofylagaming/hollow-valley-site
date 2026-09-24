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
  const bridgeTransport = String(process.env.COMMAND_BRIDGE_TRANSPORT || 'file').trim().toLowerCase();
  const binaryLaneHttpConfigured = configured('BINARYLANE_COMMAND_TOKEN');
  const bridgeTransportConfigured = bridgeTransport === 'http_pull' && binaryLaneHttpConfigured;
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
    check('presence-feed', 'BinaryLane presence feed', externalPresenceConfigured,
      externalPresenceConfigured
        ? 'BinaryLane HTTPS presence feed is configured; Render does not need direct game-server RCON.'
        : 'Set PRESENCE_FEED_TOKEN and enable the BinaryLane presence sender.'),
    check('bridge-transport', 'CommandBridge transport', bridgeTransportConfigured,
      bridgeTransport === 'http_pull'
        ? binaryLaneHttpConfigured
          ? 'BinaryLane outbound HTTPS command transport is configured.'
          : 'Set BINARYLANE_COMMAND_TOKEN for the BinaryLane HTTP-pull bridge.'
        : 'Production requires COMMAND_BRIDGE_TRANSPORT=http_pull.'),
    check('bridge-off', 'CommandBridge publishing', bridgeEnabled && solePublisherAck, bridgeEnabled
      ? solePublisherAck
        ? 'CommandBridge is online and the automation platform is the sole publisher.'
        : 'CommandBridge is enabled but the sole-publisher acknowledgement is missing.'
      : 'CommandBridge publishing is disabled.', 'safety'),
    check('publisher', 'Single CommandBridge publisher', solePublisherAck, solePublisherAck
      ? 'Automation platform is explicitly acknowledged as the sole publisher.'
      : 'Set the acknowledgement only after the automation service is the sole publisher.', 'activation'),
    check('rcon-writes', 'Render RCON writes', !rconWritesEnabled, rconWritesEnabled
      ? 'Direct Render-to-game RCON writes are enabled; BinaryLane should normally own local RCON.'
      : 'Correct for BinaryLane: direct Render RCON writes stay off while the local agent owns game-server RCON.', 'safety'),
    check('admin-restore-writes', 'Admin restore path', !adminRestoreWritesEnabled, adminRestoreWritesEnabled
      ? 'Legacy direct remote restore-file writes are enabled.'
      : 'Correct for BinaryLane: restore JSON remains available and legacy remote slot upload stays retired.', 'safety'),
    check('herbybot', 'HerbyBot automation bridge', herbyBotConfigured, herbyBotConfigured
      ? 'Dedicated HerbyBot server-to-server token is configured; Discord credentials remain on HerbyBot only.'
      : 'Optional: set HERBYBOT_AUTOMATION_TOKEN to enable durable announcements and alerts through the existing HerbyBot.', 'optional'),
    check('playtime-rewards', 'Valley Coin playtime rewards', playtimeRewardsEnabled && playtimeRewardsSafe, playtimeRewardsEnabled
      ? playtimeRewardsSafe
        ? `Rewards are online at ${playtimeRewardCoins} Valley Coin per verified 5 minutes.`
        : 'Rewards are enabled but need a working presence feed and a positive base coin rate.'
      : 'Playtime rewards are still offline until a positive base Valley Coin rate is chosen.', 'safety'),
    check('marketplace-writes', 'Marketplace buying & selling', marketplaceWritesEnabled, marketplaceWritesEnabled
      ? 'Official and player-to-player marketplace writes are online.'
      : 'Marketplace buying/selling is disabled.', 'safety'),
    check('official-marketplace-fulfillment', 'Official DinoStorage delivery', officialMarketplaceFulfillmentEnabled, officialMarketplaceFulfillmentEnabled
      ? 'Official catalog purchases are being delivered into DinoStorage.'
      : 'Official catalog DinoStorage fulfillment is disabled.', 'safety'),
    check('parked-dino-edits', 'Parked dino edits', parkedDinoEditsEnabled, parkedDinoEditsEnabled
      ? 'Mutation and skin edits for parked DinoStorage dinos are online.'
      : 'Parked dinosaur mutation/skin editing is disabled.', 'safety'),
    check('skin-system', 'Skin Studio', skinSystemEnabled, skinSystemEnabled
      ? 'Skin preset creation and application are online.'
      : 'Skin Studio is disabled.', 'safety'),
    check('monitor', 'Server outage monitoring', monitorEnabled, monitorEnabled ? 'Persistent outage/recovery monitoring is online and alerts are queued for HerbyBot.' : 'Server outage monitoring is disabled.', 'optional'),
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
