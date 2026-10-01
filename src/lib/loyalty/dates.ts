// ============================================================
// Timezone helpers (no extra deps). The store works in its own local
// time (default Asia/Kolkata): points expire at the end of a local
// day and WhatsApp sends go out at a local hour.
// ============================================================

export interface LocalDate {
  year: number;
  month: number; // 1-12
  day: number;
}

interface LocalParts extends LocalDate {
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

export function localParts(date: Date, tz: string): LocalParts {
  const parts = formatter(tz).formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

/** Offset of `tz` from UTC at `date`, in milliseconds. */
function offsetMs(date: Date, tz: string): number {
  const p = localParts(date, tz);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The UTC instant at which the wall clock in `tz` reads the given time. */
export function zonedTimeToUtc(
  d: LocalDate,
  hour: number,
  minute: number,
  second: number,
  tz: string,
  ms = 0
): Date {
  const guess = Date.UTC(d.year, d.month - 1, d.day, hour, minute, second, ms);
  let result = guess - offsetMs(new Date(guess), tz);
  // Second pass settles DST transitions.
  const corrected = guess - offsetMs(new Date(result), tz);
  if (corrected !== result) result = corrected;
  return new Date(result);
}

export function localDate(date: Date, tz: string): LocalDate {
  const { year, month, day } = localParts(date, tz);
  return { year, month, day };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Calendar month arithmetic; clamps to month end (31 Jan + 1 → 28/29 Feb). */
export function addMonthsLocal(d: LocalDate, months: number): LocalDate {
  const index = d.year * 12 + (d.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return { year, month, day: Math.min(d.day, daysInMonth(year, month)) };
}

export function addDaysLocal(d: LocalDate, days: number): LocalDate {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return {
    year: t.getUTCFullYear(),
    month: t.getUTCMonth() + 1,
    day: t.getUTCDate(),
  };
}

/** Last millisecond of local day `d` in `tz`. */
export function endOfLocalDay(d: LocalDate, tz: string): Date {
  return zonedTimeToUtc(d, 23, 59, 59, tz, 999);
}

export function formatLocalDate(d: LocalDate): string {
  const mm = String(d.month).padStart(2, '0');
  const dd = String(d.day).padStart(2, '0');
  return `${d.year}-${mm}-${dd}`;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Human date for WhatsApp copy, e.g. "1 Jan 2027". */
export function displayDate(date: Date | string, tz: string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: tz,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

/** Whole local days from `from` to `to` (ignoring time of day). */
export function localDaysBetween(from: Date, to: Date, tz: string): number {
  const a = localDate(from, tz);
  const b = localDate(to, tz);
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) -
      Date.UTC(a.year, a.month - 1, a.day)) /
      86_400_000
  );
}
