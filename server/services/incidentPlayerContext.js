'use strict';
const timeline = require('./incidentTimeline');
const {project} = require('./reportContext');
const {createHash} = require('node:crypto');
const WINDOW_MS = 900000, MAX_EVENTS = 200;
const fail = (status, message) => { throw Object.assign(Error(message), {status}); };
const steam = value => typeof value === 'string' && /^\d{17}$/.test(value);
const stamp = value => {
  const at = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isSafeInteger(at) && at >= WINDOW_MS && new Date(at).toISOString() === value ? at : null;
};

function createIncidentPlayerContext({db, automation, enabled = () => process.env.INCIDENT_PLAYER_CONTEXT_ENABLED === '1', now = Date.now} = {}) {
  function admin(getUser, binding) {
    const user = getUser();
    if (!Number.isSafeInteger(user?.id) || !steam(user?.steam_id)) fail(403, 'Current linked admin access is required.');
    const current = db.prepare('SELECT id,steam_id,is_admin FROM users WHERE id=?').get(user.id);
    if (!current?.is_admin || current.steam_id !== user.steam_id) fail(403, 'Current linked admin access is required.');
    const actual = current.id + ':' + current.steam_id;
    if (binding !== undefined && binding !== actual) fail(403, 'Reload incident history for the current admin account.');
    return actual;
  }
  function capabilities(getUser) {
    return {reviewerBinding: admin(getUser), enabled: Boolean(enabled()), windowMinutes: 15, complete: false};
  }
  function savedReport(id) {
    if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) fail(400, 'Invalid report reference.');
    const row = db.prepare('SELECT id,reporter_steam_id,reported_steam_id,occurred_at FROM player_reports WHERE id=?').get(id);
    if (!row) fail(404, 'Report not found.');
    if (!steam(row.reporter_steam_id) || (row.reported_steam_id !== null && (!steam(row.reported_steam_id) || row.reported_steam_id === row.reporter_steam_id)) || (row.occurred_at !== null && stamp(row.occurred_at) === null)) fail(409, 'The saved report participants or time cannot be verified.');
    return row;
  }
  const fingerprint = row => createHash('sha256').update(JSON.stringify(row)).digest('hex');
  function reportDetails(getUser, binding, id) {
    const actor = admin(getUser, binding);
    if (binding !== actor) fail(403, 'Reload incident history for the current admin account.');
    if (!enabled()) fail(503, 'Player incident context is not enabled.');
    const row = savedReport(id), at = row.occurred_at === null ? null : stamp(row.occurred_at), clock = now();
    if (!Number.isSafeInteger(clock) || clock < WINDOW_MS || clock > 8640000000000000 - WINDOW_MS) fail(502, 'The context observation time could not be verified.');
    const reason = at === null ? 'time-required' : at < clock - 90 * 86400000 || at > clock + WINDOW_MS ? 'time-outside-source-window' : null;
    return {version: 1, reviewerBinding: actor, report: {id: row.id, fingerprint: fingerprint(row), occurredAt: row.occurred_at,
      participants: [{role: 'reporter', steamId: row.reporter_steam_id}, ...(row.reported_steam_id ? [{role: 'reported', steamId: row.reported_steam_id}] : [])],
      canInvestigate: reason === null, reason}};
  }
  async function readReport(getUser, binding, id, input) {
    const details = reportDetails(getUser, binding, id), saved = details.report;
    if (!input || Array.isArray(input) || Object.keys(input).some(key => !['role','fingerprint'].includes(key)) || !['reporter','reported'].includes(input.role) || typeof input.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(input.fingerprint)) fail(400, 'A reviewed saved-report participant is required.');
    if (input.fingerprint !== saved.fingerprint) fail(409, 'The saved report changed. Reload its details before investigating.');
    const participant = saved.participants.find(value => value.role === input.role);
    if (!participant || !saved.canInvestigate) fail(409, 'The saved report has no usable participant or incident time.');
    // Freeze the displayed participant/time; callers cannot supply replacement query fields.
    const role = input.role, selected = {steamId: participant.steamId, occurredAt: saved.occurredAt};
    let result, failed;
    try { result = await read(getUser, binding, selected); } catch (error) { failed = error; }
    const current = reportDetails(getUser, binding, id);
    if (current.report.fingerprint !== saved.fingerprint || !current.report.canInvestigate) fail(409, 'The saved report changed while context was loading.');
    if (failed) throw failed;
    return {...result, report: {id, fingerprint: saved.fingerprint, role}};
  }
  async function read(getUser, binding, input) {
    const actor = admin(getUser, binding);
    if (binding !== actor) fail(403, 'Reload incident history for the current admin account.');
    if (!enabled()) fail(503, 'Player incident context is not enabled.');
    const clock = now(), at = stamp(input?.occurredAt);
    if (!input || Array.isArray(input) || Object.keys(input).some(key => !['steamId', 'occurredAt'].includes(key)) || !steam(input.steamId) || at === null || !Number.isSafeInteger(clock) || clock < WINDOW_MS || clock > 8640000000000000 - WINDOW_MS || at < clock - 90 * 86400000 || at > clock + WINDOW_MS) fail(400, 'A player and valid approximate incident time within the supported window are required.');
    const query = {steamId: input.steamId, occurredAt: input.occurredAt};
    const results = await Promise.allSettled([
      Promise.resolve().then(() => automation.getAdminAudit({limit: timeline.AUDIT_LIMIT})),
      Promise.resolve().then(() => automation.getAdminRequests({limit: timeline.REQUEST_LIMIT})),
      Promise.resolve().then(() => automation.getAdminReportContext({reporterSteamId: query.steamId, reportedSteamId: null, occurredAt: query.occurredAt})),
    ]);
    admin(getUser, actor);
    if (!enabled()) fail(503, 'Player incident context is not enabled.');
    const finished = now();
    if (!Number.isSafeInteger(finished) || finished < clock || finished > 8640000000000000 - WINDOW_MS) fail(502, 'The context observation time could not be verified.');
    const start = at - WINDOW_MS, end = Math.min(clock, at + WINDOW_MS), events = [], partialSources = [];
    const scanned = {audit: 0, requests: 0};
    let hasMoreUnloaded = false, available = 0;
    for (const [index, source, key, cap, normalize] of [
      [0, 'audit', 'audit', timeline.AUDIT_LIMIT, timeline.normalizeAudit],
      [1, 'requests', 'requests', timeline.REQUEST_LIMIT, timeline.normalizeRequest],
    ]) {
      const result = results[index];
      if (result.status !== 'fulfilled' || !Array.isArray(result.value?.[key])) { partialSources.push(source); continue; }
      available++;
      const rows = result.value[key].slice(0, cap); scanned[source] = rows.length;
      hasMoreUnloaded ||= result.value[key].length >= cap;
      for (const row of rows) {
        const event = normalize(row);
        if (event && (event.playerSteamId === query.steamId || event.actorSteamId === query.steamId) && Date.parse(event.at) >= start && Date.parse(event.at) <= end) events.push(event);
      }
    }
    let context;
    try {
      if (results[2].status !== 'fulfilled') throw Error('Unavailable');
      context = project(results[2].value, {occurred_at: query.occurredAt, reporter_steam_id: query.steamId, reported_steam_id: null}, finished);
    } catch { partialSources.push('combat', 'chat'); }
    if (context && !partialSources.includes('combat')) {
      for (const [source, payload, rows] of [['combat', context.combat, context.combat.events], ['chat', context.chat, context.chat.messages]]) {
        if (!payload.available) { partialSources.push(source); continue; }
        available++; hasMoreUnloaded ||= payload.truncated;
        // Source reads can finish later; keep events inside the window fixed at request start.
        for (const row of rows.filter(value => Date.parse(value.at) >= start && Date.parse(value.at) <= end)) events.push({source, id: row.id, at: row.at, category: source === 'combat' ? 'recorded combat' : 'retained chat', action: source === 'combat' ? 'combat participant' : 'chat message', status: 'recorded', playerSteamId: query.steamId,
          ...(source === 'combat' ? {playerRole: row.attacker === 'reporter' && row.victim === 'reporter' ? 'attacker-and-victim' : row.attacker === 'reporter' ? 'attacker' : 'victim', otherPlayerIdentityWithheld: true} : {text: row.text, channel: row.channel, redacted: row.redacted, digest: row.digest})});
      }
    }
    if (!available) fail(502, 'Player incident sources are unavailable.');
    events.sort((a,b) => b.at.localeCompare(a.at) || a.source.localeCompare(b.source) || b.id.localeCompare(a.id));
    return {version: 1, reviewerBinding: actor, query, windowStart: new Date(start).toISOString(), windowEnd: new Date(end).toISOString(), complete: false, associationOnly: true,
      events: events.slice(0, MAX_EVENTS), partialSources, sourceCounts: scanned, hasMoreUnloaded: hasMoreUnloaded || events.length > MAX_EVENTS, fetchedAt: new Date(finished).toISOString()};
  }
  return {capabilities, read, reportDetails, readReport};
}
let reader;
function getDefaultReader() {
  return reader ||= createIncidentPlayerContext({db: require('../db').db, automation: require('./automationWebsiteClient')});
}
module.exports = {createIncidentPlayerContext, getDefaultReader, MAX_EVENTS};
