require('dotenv').config();

const path = require('node:path');
const express = require('express');
const { getPlatformStatus } = require('./services/statusService');
const bodyDropRoutes = require('./routes/bodyDropRoutes');
const { startBodyDropReconciler } = require('./services/bodyDropService');

const app = express();
const port = Number(process.env.PORT || 3100);
const publicDir = path.join(__dirname, '..', 'public');

app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use(express.static(publicDir, { extensions: ['html'] }));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'hollow-valley-automation-platform',
    time: new Date().toISOString(),
  });
});

app.get(['/status', '/api/status'], async (req, res) => {
  try {
    const status = await getPlatformStatus({ force: req.query.force === '1' });
    res.json(status);
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

app.use('/api/bodydrop', bodyDropRoutes);

app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

if (require.main === module) {
  startBodyDropReconciler();
  app.listen(port, () => {
    console.log(`Hollow Valley automation platform listening on port ${port}`);
  });
}

module.exports = { app };
