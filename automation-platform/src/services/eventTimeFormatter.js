// Fixed QLD civil time for community event communications. Render is UTC and
// Sydney observes daylight saving; Brisbane (Australia/Brisbane) does not.
const QLD_TIME_ZONE = 'Australia/Brisbane';

const formatter = new Intl.DateTimeFormat('en-AU', {
  timeZone: QLD_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function formatEventTimeQld(timestamp) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new TypeError('Valid event timestamp required');
  const parts = Object.fromEntries(formatter.formatToParts(date)
    .filter(part => part.type !== 'literal')
    .map(part => [part.type, part.value]));
  return `${parts.day}-${parts.month}-${parts.year} ${parts.hour}:${parts.minute} (QLD time)`;
}

module.exports = { QLD_TIME_ZONE, formatEventTimeQld };
