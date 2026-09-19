require('dotenv').config();

const path = require('node:path');
const express = require('express');
const { getPublicStatus, getServerSnapshot, integrationConfig } = require('./services/statusService');
const fileBridge = require('./adapters/fileBridge');
const store = require('./services/automationStore');
const { getMigrationReadiness } = require('./services/migrationReadinessService');
const { requireAdminToken } = require('./middleware/adminAuth');
const audit = require('./services/auditService');
const backupService = require('./services/backupService');
const adminRoutes = require('./routes/adminRoutes');
const websiteRoutes = require('./routes/websiteRoutes');
const websiteAdminWalletRoutes = require('./routes/websiteAdminWalletRoutes');
const websiteDailyLoginRoutes = require('./routes/websiteDailyLoginRoutes');
const herbyBotRoutes = require('./routes/herbyBotRoutes');
const bodyDropRoutes = require('./routes/bodyDropRoutes');
const dinoStorageRoutes = require('./routes/dinoStorageRoutes');
const { startBodyDropReconciler } = require('./services/bodyDropService');
const { startDinoStorageReconciler, recoverInterruptedDinoStorage } = require('./services/dinoStorageService');
const { startDinoMarketplaceReconciler } = require('./services/dinoMarketplaceService');
const { seedOfficialCatalog } = require('./services/officialMarketplaceCatalogService');
const { startOfficialMarketplaceFulfillment } = require('./services/officialMarketplaceFulfillmentService');
const { startDiscordAutomation } = require('./services/discordAutomationService');
const { startScheduler } = require('./services/schedulerService');
const { startServerMonitor } = require('./services/serverMonitorService');
const playerPresence = require('./services/playerPresenceService');
const serverHealthHistory = require('./services/serverHealthHistoryService');

const app = express();
const port = Number(process.env.PORT || 3100);
const publicDir = path.join(__dirname, '..', 'public');

function buildStorageHealth() {
  const dbPath = String(store.dbPath || '').trim();
  const databasePersistent = Boolean(dbPath) &&
    dbPath !== ':memory:' &&
    !path.resolve(dbPath).includes(`${path.sep}tmp${path.sep}`);

  let probe = store.getState('health:persistence-probe', null);
  if (!probe?.value?.initializedAt) {
    probe = store.setState('health:persistence-probe', {
      initializedAt: new Date().toISOString(),
    });
  }

  return {
    databasePersistent,
    initializedAt: probe?.value?.initializedAt || null,
  };
}

const storageHealth = buildStorageHealth();

async function runStartupReadOnlyDiagnostics() {
  const integrations = integrationConfig();

  if (!integrations.rcon) {
    console.log('[startup-check] rcon configured=false');
  } else {
    const server = await getServerSnapshot({ force: true });
    console.log(
      `[startup-check] rcon configured=true online=${server.online} players=${server.players.length} error=${Boolean(server.error)}`
    );
  }

  try {
    fileBridge.getConfig();
  } catch {
    console.log('[startup-check] ftp configured=false');
    return;
  }

  try {
    const entries = await fileBridge.withClient((client) => client.list(fileBridge.getUe4ssRemotePath()));
    console.log(`[startup-check] ftp configured=true connected=true ue4ssEntries=${entries.length}`);
  } catch (error) {
    console.log(
      `[startup-check] ftp configured=true connected=false errorCode=${String(error?.code || error?.name || 'unknown')}`
    );
  }
}

app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use(express.static(publicDir, { extensions: ['html'] }));

app.get('/health', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    ok: true,
    service: 'hollow-valley-automation-platform',
    time: new Date().toISOString(),
    storage: storageHealth,
  });
});

app.get(['/status', '/api/status'], async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await getPublicStatus({ force: req.query.force === '1' }));
  } catch (error) {
    console.error('[automation-status]', error);
    res.status(503).json({
      ok: false,
      service: 'hollow-valley-automation-platform',
      time: new Date().toISOString(),
      error: 'Status service unavailable',
    });
  }
});

app.get('/api/admin/presence/analytics', requireAdminToken, (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const hours = Math.max(1, Math.min(24 * 31, Number(req.query.hours) || 24));
    res.json({ analytics: playerPresence.getPresenceAnalytics({ hours }) });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to calculate player presence analytics.' });
  }
});

app.get('/api/admin/server-health/analytics', requireAdminToken, (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const hours = Math.max(1, Math.min(24 * 31, Number(req.query.hours) || 24));
    res.json({ analytics: serverHealthHistory.getHealthAnalytics({ hours }) });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to calculate server health analytics.' });
  }
});

app.get('/api/admin/migration-readiness', requireAdminToken, (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ readiness: getMigrationReadiness() });
});

app.get('/api/admin/backups', requireAdminToken, (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ backups: backupService.getBackupState() });
});

app.post('/api/admin/backups', requireAdminToken, async (_req, res) => {
  try {
    const result = await audit.run('backup', 'create_snapshot', {},
      async () => backupService.createBackup(),
      (value) => ({ fileName: value.fileName || null, size: value.size || 0, retained: value.retained || 0 }));
    res.status(result.skipped ? 202 : 201).json({ ok: true, backup: result });
  } catch (error) {
    res.status(503).json({ error: error.message || 'Automation backup failed.' });
  }
});

app.use('/api/admin', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
}, adminRoutes);

app.use('/api/website/admin-wallet', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
}, websiteAdminWalletRoutes);

app.use('/api/website/daily-login', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
}, websiteDailyLoginRoutes);

app.use('/api/website', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
}, websiteRoutes);

app.use('/api/herbybot', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
}, herbyBotRoutes);

app.use('/api/bodydrop', bodyDropRoutes);
app.use('/api/dinostorage', dinoStorageRoutes);

app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

if (require.main === module) {
  seedOfficialCatalog();
  const recoveredDinoStorage = recoverInterruptedDinoStorage();
  if (recoveredDinoStorage) {
    console.warn(`[dinostorage-recover] marked ${recoveredDinoStorage} interrupted request(s) unknown; none were replayed`);
  }
  startBodyDropReconciler();
  startDinoStorageReconciler();
  startDinoMarketplaceReconciler();
  startOfficialMarketplaceFulfillment();
  startDiscordAutomation();
  startScheduler();
  startServerMonitor();
  playerPresence.startPlayerPresence();
  serverHealthHistory.startServerHealthHistory();
  backupService.startBackups();
  app.listen(port, () => {
    console.log(`Hollow Valley automation platform listening on port ${port}`);
    console.log(`[storage] persistent=${storageHealth.databasePersistent} initializedAt=${storageHealth.initializedAt}`);
    runStartupReadOnlyDiagnostics().catch(() => {
      console.log('[startup-check] diagnostics failed');
    });
  });
}

module.exports = { app };
