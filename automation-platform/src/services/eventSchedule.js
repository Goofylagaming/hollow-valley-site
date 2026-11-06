// Shared validation without database or environment side effects.
const TIMEZONE = 'Australia/Brisbane';
function validateSchedule(input) {
  const mode = input.scheduleMode || 'duration';
  if (!['duration', 'range'].includes(mode)) throw new Error('Choose duration or range scheduling');
  if (mode === 'duration') {
    if (input.endsAt != null) throw new Error('End time requires range scheduling');
    if (!Number.isSafeInteger(input.durationMinutes) || input.durationMinutes < 5 || input.durationMinutes > 720)
      throw new Error('Event duration must be 5–720 minutes');
    return { mode, duration: input.durationMinutes };
  }
  if (input.timezone !== TIMEZONE) throw new Error('Exact schedules require Australia/Brisbane');
  function timestamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value))
      throw new Error('Exact schedule timestamps must be UTC ISO dates');
    const ms = Date.parse(value);
    if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value.replace(/Z$/, value.includes('.') ? 'Z' : '.000Z'))
      throw new Error('Invalid schedule date');
    return ms;
  }
  const start = timestamp(input.startsAt), end = timestamp(input.endsAt);
  const duration = (end - start) / 60000;
  if (!Number.isSafeInteger(duration) || duration < 5 || duration > 30 * 24 * 60)
    throw new Error('Exact schedule duration must be 5 minutes to 30 days');
  return { mode, start, end, duration };
}
module.exports = { TIMEZONE, validateSchedule };
