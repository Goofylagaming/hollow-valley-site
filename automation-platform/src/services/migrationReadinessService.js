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
  const bridgeEnabled = process.env.COMMAND_BRIDGE_ENABLED === 'true';
  const solePublisherAck = String(process.env.COMMAND_BRIDGE_SINGLE_PUBLISHER_ACK || '').trim() === PUBLISHER_ACK;
  const rconWritesEnabled = process.env.RCON_WRITE_ENABLED === 'true';
  const adminRestoreWritesEnabled = process.env.ADMIN_RESTORE_WRITE_ENABLED === 'true';
  const presenceEnabled = process.env.PLAYER_PRESENCE_ENABLED === 'true';
  const monitorEnabled = process.env.SERVER_MONITOR_ENABLED === 'true';

  const checks = [
    check('admin-token', 'Operator admin token', configured('AUTOMATION_ADMIN_TOKEN'), configured('AUTOMATION_ADMIN_TOKEN') ? 'Admin API is protected.' : 'Set AUTOMATION_ADMIN_TOKEN before exposing the operator console.'),
    check('website-token', 'Website integration token', configured('HOLLOW_VALLEY_API_TOKEN'), configured('HOLLOW_VALLEY_API_TOKEN') ? 'Separate server-to-server credential is configured.' : 'Set a dedicated HOLLOW_VALLEY_API_TOKEN before connecting the live website.'),
    check('database', 'Persistent automation database', dbPersistent, dbPersistent ? `Automation state uses ${dbPath}.` : 'Use a persistent disk path for AUTOMATION_DB_PATH; in-memory/temporary storage is not production-safe.'),
    check('rcon-read', 'Read-only Evrima RCON', rconConfigured, rconConfigured ? 'RCON credentials are configured.' : 'Add RCON_HOST, RCON_PORT and RCON_PASSWORD for server/player reads.'),
    check('ftp', 'VeryGames file access', ftpConfigured, ftpConfigured ? 'FTP credentials and base path are configured.' : 'Add SFTP_HOST/PORT/USER/PASSWORD/BASE_PATH (names retained for compatibility).'),
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
    check('presence', 'Presence tracking', presenceEnabled, presenceEnabled ? 'Read-only session tracking is enabled.' : 'Optional: enable only after stable read-only RCON verification.', 'optional'),
    check('monitor', 'Server outage monitoring', monitorEnabled, monitorEnabled ? 'Persistent outage/recovery monitoring is enabled.' : 'Optional: enable after Discord alerts and RCON stability are verified.', 'optional'),
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
    readyForCommandBridgeMigration: required.every((item) => item.ready) && safetyReady && activationReady && ftpConfigured,
    requiredReady,
    requiredTotal: required.length,
    checks,
  };
}

module.exports = { getMigrationReadiness };
