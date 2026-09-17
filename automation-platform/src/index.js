require('dotenv').config();

const path = require('node:path');
const express = require('express');
const { getPublicStatus } = require('./services/statusService');
const adminRoutes = require('./routes/adminRoutes');
const websiteRoutes = require('./routes/websiteRoutes');
const bodyDropRoutes = require('./routes/bodyDropRoutes');
const dinoStorageRoutes = require('./routes/dinoStorageRoutes');
const { startBodyDropReconciler } = require('./services/bodyDropService');
const { startDinoStorageReconciler } = require('./services/dinoStorageService');
const { startDiscordAutomation } = require('./services/discordAutomationService');
const { startScheduler } = require('./services/schedulerService');
const { startServerMonitor } = require('./services/serverMonitorService');
const { startPlayerPresence } = require('./services/playerPresenceService');

const app = express();
const port = Number(process.env.PORT || 3100);
const publicDir = path.join(__dirname, '..', 'public');

app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use(express.static(publicDir, { extensions: ['html'] }));

app.get('/health', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    ok: true,
    service: 'hollow-valley-automation-platform',
    time: new Date().toISOString(),
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

app.use('/api/admin', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
}, adminRoutes);

app.use('/api/website', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
}, websiteRoutes);

app.use('/api/bodydrop', bodyDropRoutes);
app.use('/api/dinostorage', dinoStorageRoutes);

app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

if (require.main === module) {
  startBodyDropReconciler();
  startDinoStorageReconciler();
  startDiscordAutomation();
  startScheduler();
  startServerMonitor();
  startPlayerPresence();
  app.listen(port, () => {
    console.log(`Hollow Valley automation platform listening on port ${port}`);
  });
}

module.exports = { app };
