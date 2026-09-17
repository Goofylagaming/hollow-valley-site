const { randomUUID } = require('node:crypto');
const store = require('./automationStore');
const discord = require('./discordAutomationService');

const RECURRENCES = new Set(['none', 'daily', 'weekly']);
let cycleRunning = false;

function validateRunAt(value, { requireFuture = true } = {}) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) throw new Error('A valid scheduled date/time is required');
  if (requireFuture && date.getTime() <= Date.now()) throw new Error('Scheduled date/time must be in the future');
  return date.toISOString();
}

function validateRecurrence(value) {
  const recurrence = String(value || 'none').trim().toLowerCase();
  if (!RECURRENCES.has(recurrence)) throw new Error('Recurrence must be none, daily or weekly');
  return recurrence;
}

function nextRecurringRun(previousRunAt, recurrence, now = Date.now()) {
  const intervalMs = recurrence === 'daily' ? 24 * 60 * 60 * 1000 : recurrence === 'weekly' ? 7 * 24 * 60 * 60 * 1000 : 0;
  if (!intervalMs) return null;
  let next = new Date(previousRunAt).getTime() + intervalMs;
  while (next <= now) next += intervalMs;
  return new Date(next).toISOString();
}

function createDiscordAnnouncementJob({ message, runAt, recurrence = 'none' }) {
  if (!discord.announcementConfigured()) {
    throw new Error('Discord announcement automation is not configured');
  }
  const clean = discord.cleanMessage(message);
  const scheduledAt = validateRunAt(runAt);
  const repeat = validateRecurrence(recurrence);
  return store.createJob({
    id: randomUUID(),
    type: 'discord_announcement',
    runAt: scheduledAt,
    recurrence: repeat,
    payload: { message: clean },
  });
}

function cancelJob(id) {
  const job = store.getJob(String(id || '').trim());
  if (!job) throw new Error('Scheduled job not found');
  if (!['scheduled', 'failed'].includes(job.status)) throw new Error(`Job cannot be cancelled while ${job.status}`);
  return store.updateJob(job.id, { status: 'cancelled' });
}

async function executeJob(job) {
  const attempts = Number(job.attempts || 0) + 1;
  const startedAt = new Date().toISOString();
  store.updateJob(job.id, { status: 'running', attempts, lastRunAt: startedAt, lastError: null });

  try {
    if (job.type === 'discord_announcement') {
      await discord.sendAnnouncement(job.payload?.message, { nonce: job.id });
    } else {
      throw new Error(`Unsupported automation job type: ${job.type}`);
    }

    const nextRun = nextRecurringRun(job.run_at, job.recurrence);
    if (nextRun) {
      return store.updateJob(job.id, {
        status: 'scheduled',
        runAt: nextRun,
        lastError: null,
        lastRunAt: startedAt,
      });
    }
    return store.updateJob(job.id, { status: 'completed', lastError: null, lastRunAt: startedAt });
  } catch (error) {
    return store.updateJob(job.id, {
      status: 'failed',
      lastError: error.message || String(error),
      lastRunAt: startedAt,
    });
  }
}

async function runDueJobs() {
  if (cycleRunning) return { skipped: true, checked: 0, completed: 0, failed: 0 };
  cycleRunning = true;
  let completed = 0;
  let failed = 0;
  try {
    const jobs = store.listDueJobs(new Date().toISOString(), 25);
    for (const job of jobs) {
      const result = await executeJob(job);
      if (result?.status === 'failed') failed += 1;
      else completed += 1;
    }
    return { skipped: false, checked: jobs.length, completed, failed };
  } finally {
    cycleRunning = false;
  }
}

function getSchedulerState() {
  const jobs = store.listJobs({ limit: 500 });
  const summary = { total: jobs.length, scheduled: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
  for (const job of jobs) {
    if (Object.hasOwn(summary, job.status)) summary[job.status] += 1;
  }
  return { summary, jobs };
}

function startScheduler() {
  const recovered = store.recoverInterruptedJobs();
  if (recovered) console.warn(`[scheduler] recovered ${recovered} interrupted job(s)`);
  const intervalMs = Math.max(5000, Number(process.env.AUTOMATION_SCHEDULER_INTERVAL_MS || 15000));
  runDueJobs().catch((error) => console.warn('[scheduler]', error.message));
  const timer = setInterval(() => {
    runDueJobs().catch((error) => console.warn('[scheduler]', error.message));
  }, intervalMs);
  timer.unref?.();
  return timer;
}

module.exports = {
  validateRunAt,
  validateRecurrence,
  nextRecurringRun,
  createDiscordAnnouncementJob,
  cancelJob,
  executeJob,
  runDueJobs,
  getSchedulerState,
  startScheduler,
};
