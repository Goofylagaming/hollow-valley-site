export const week = '2026-11-16';
export const ending = '2026-11-22';
export const store = 'Gumleaf General';
export const budget = 1300;
export const people = [
  { name: 'Sam Finch', job: 'Shop floor' },
  { name: 'Alex Vale', job: 'Front counter' },
  { name: 'Remy Moss', job: 'Stockroom' },
];
export const shifts = [
  { day: 'Mon 16', date: '2026-11-16', who: 0, start: '08:30', end: '17:00', break: 30, rate: 24 },
  { day: 'Tue 17', date: '2026-11-17', who: 1, start: '08:30', end: '17:00', break: 30, rate: 24 },
  { day: 'Wed 18', date: '2026-11-18', who: 2, start: '08:30', end: '17:00', break: 30, rate: 24 },
  { day: 'Thu 19', date: '2026-11-19', who: 0, start: '08:30', end: '17:00', break: 30, rate: 24 },
  { day: 'Fri 20', date: '2026-11-20', who: 1, start: '08:30', end: '17:00', break: 30, rate: 24 },
  { day: 'Sat 21', date: '2026-11-21', who: 2, start: '10:00', end: '14:00', break: 0, rate: 32 },
];
export function hours(s) {
  const minutes = time => Number(time.slice(0,2)) * 60 + Number(time.slice(3));
  return (minutes(s.end) - minutes(s.start) - s.break) / 60;
}
export const baseCost = shifts.slice(0,-1).reduce((total,s) => total + s.rate * hours(s), 0);
export const saturdayCost = hours(shifts.at(-1)) * shifts.at(-1).rate;
