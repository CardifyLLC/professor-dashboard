export const ORDER_TIME_ZONE = 'America/Los_Angeles';

const pacificDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: ORDER_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
});

const getDateTimeParts = (value) => Object.fromEntries(
    pacificDateTimeFormatter.formatToParts(value)
        .filter(part => part.type !== 'literal')
        .map(part => [part.type, Number(part.value)])
);

export const pacificMidnightToUtc = (date) => {
    const [year, month, day] = date.split('-').map(Number);
    const targetAsUtc = Date.UTC(year, month - 1, day);
    const rendered = getDateTimeParts(new Date(targetAsUtc));
    const renderedAsUtc = Date.UTC(
        rendered.year,
        rendered.month - 1,
        rendered.day,
        rendered.hour,
        rendered.minute,
        rendered.second
    );
    return new Date(targetAsUtc - (renderedAsUtc - targetAsUtc));
};

export const getPacificDate = (value) => {
    const { year, month, day } = getDateTimeParts(new Date(value));
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

export const getCurrentPacificDate = () => getPacificDate(new Date());

export const nextCalendarDate = date => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
};
