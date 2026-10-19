const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const parts = value => Object.fromEntries(formatter.formatToParts(value)
  .filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));

export function getCurrentPacificDate(now = new Date()) {
  const { year, month, day } = parts(now);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function midnight(target) {
  let value = target;
  // Resolve each midnight separately so DST days may contain 23 or 25 hours.
  for (let attempt = 0; attempt < 3; attempt++) {
    const p = parts(new Date(value));
    const difference = target - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    value += difference;
    if (!difference) return new Date(value).toISOString();
  }
  throw new Error('Choose a valid order date.');
}

export function pacificDayRange(date) {
  if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(date || '')) throw new Error('Choose a valid order date.');
  const timestamp = Date.parse(date + 'T00:00:00.000Z');
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) throw new Error('Choose a valid order date.');
  return { from: midnight(timestamp), before: midnight(timestamp + 86400000) };
}
