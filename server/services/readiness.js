'use strict';

// Local storage readiness only: upstream downtime must not restart this process.
function installReadiness(app, probe, service) {
  let draining = false;
  const revision = process.env.RENDER_GIT_COMMIT || null;
  app.get('/healthz', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ ok: true, service, revision });
  });
  app.get('/readyz', (_req, res) => {
    let ready = !draining;
    try { if (ready) probe(); } catch { ready = false; }
    res.set('Cache-Control', 'no-store').status(ready ? 200 : 503)
      .json({ ok: ready, service, revision });
  });
  return { drain() { draining = true; } };
}

module.exports = { installReadiness };
