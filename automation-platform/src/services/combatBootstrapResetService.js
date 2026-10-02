const store = require('./automationStore');
const combat = require('./combatEventService');

function configuredIds(env = process.env) {
  return [...new Set(
    String(env.COMBAT_BOOTSTRAP_RESET_STEAM_IDS || '')
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter((value) => /^\d{17}$/.test(value))
  )];
}

function batchId(env = process.env) {
  const raw = String(env.COMBAT_BOOTSTRAP_RESET_BATCH || 'default').trim();
  return /^[A-Za-z0-9_.:-]{1,80}$/.test(raw) ? raw : 'default';
}

function runConfiguredCombatResets(env = process.env) {
  const ids = configuredIds(env);
  if (!ids.length) return { configured: false, reset: 0, skipped: 0, results: [] };

  const batch = batchId(env);
  const results = [];
  let reset = 0;
  let skipped = 0;

  for (const steamId of ids) {
    const markerKey = `combat:bootstrap-reset:${batch}:${steamId}`;
    const marker = store.getState(markerKey, null);
    if (marker?.value?.completedAt) {
      skipped += 1;
      results.push({ steamId, skipped: true, resetAt: marker.value.resetAt || null });
      continue;
    }

    const result = combat.resetPlayerStats(steamId, {
      reason: `Configured one-time combat reset (${batch})`,
    });
    store.setState(markerKey, {
      completedAt: new Date().toISOString(),
      resetAt: result.resetAt,
    });
    reset += 1;
    results.push({ steamId, skipped: false, resetAt: result.resetAt });
  }

  return { configured: true, batch, reset, skipped, results };
}

module.exports = { configuredIds, batchId, runConfiguredCombatResets };
