"use strict";
const { createSeasonTrackStore } = require('./seasonTrackStore');
const enabled = () => process.env.SEASON_TRACK_ENABLED === '1';
const available = () => enabled() || process.env.SEASON_TRACK_MANAGEMENT_ENABLED === '1';
function get() {
  if (!available()) throw Object.assign(new Error('Season tracking is not enabled'), { status: 503 });
  // Operator initialization is explicit. Visiting the page never installs an XP
  // trigger, creates a season catalog or grants permanent XP via reconciliation.
  const { db } = require('./economyStore');
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
  if (!['progression_seasons', 'progression_season_audit', 'progression_season_enrollments', 'progression_season_evidence',
    'progression_season_source_positions', 'progression_season_choices', 'progression_season_requests', 'progression_xp_source_times'].every(name => tables.has(name)) ||
      !db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='progression_season_source_insert'").get()) {
    throw Object.assign(new Error('Reviewed season tracking is not ready'), { status: 503 });
  }
  return createSeasonTrackStore(db, { initialize: false, writable: () => {
    if (process.env.SEASON_TRACK_READ_ONLY === '1') throw Object.assign(new Error('Season progress is read-only'), { status: 403 });
  } });
}
module.exports = { get, enabled, available };
