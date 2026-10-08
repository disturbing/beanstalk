/**
 * `on.schedule` cron (POSIX five fields, UTC, as GitHub reads them): minute, hour, day of
 * month, month (1-12 or JAN-DEC), day of week (0-6 or SUN-SAT, 7 is Sunday). `*`, lists,
 * ranges and steps. When both day fields are restricted, a day matching either fires (cron's
 * rule). GitHub runs schedules at most every 5 minutes; so does Beanstalk.
 */

/** Schedules never fire closer together than this. */
export const MIN_SCHEDULE_INTERVAL_MS = 5 * 60 * 1000;

export type CronSchedule = {
  readonly minutes: ReadonlySet<number>;
  readonly hours: ReadonlySet<number>;
  readonly days: ReadonlySet<number>;
  readonly months: ReadonlySet<number>;
  readonly weekdays: ReadonlySet<number>;
  readonly isDayRestricted: boolean;
  readonly isWeekdayRestricted: boolean;
};

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MINUTE_MS = 60 * 1000;
/** Search horizon: a valid schedule fires within four years (29 February). */
const HORIZON_MS = 4 * 366 * 24 * 60 * MINUTE_MS;

/** The schedule a cron line describes, or null when it is not valid cron. */
export function parseCron(line: string): CronSchedule | null {
  const fields = line.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minute, hour, day, month, weekday] = fields;
  const minutes = parseField(minute, { min: 0, max: 59, names: [] });
  const hours = parseField(hour, { min: 0, max: 23, names: [] });
  const days = parseField(day, { min: 1, max: 31, names: [] });
  const months = parseField(month, { min: 1, max: 12, names: MONTHS, nameBase: 1 });
  const weekdaysRaw = parseField(weekday, { min: 0, max: 7, names: WEEKDAYS, nameBase: 0 });
  if (!minutes || !hours || !days || !months || !weekdaysRaw) return null;
  const weekdays = new Set([...weekdaysRaw].map((value) => value % 7));
  return {
    minutes,
    hours,
    days,
    months,
    weekdays,
    isDayRestricted: day !== '*',
    isWeekdayRestricted: weekday !== '*',
  };
}

/** The first time after `afterMs` (exclusive) the schedule fires, in ms; null if never. */
export function nextFireMs(schedule: CronSchedule, afterMs: number): number | null {
  let at = new Date(Math.floor(afterMs / MINUTE_MS) * MINUTE_MS + MINUTE_MS);
  const limit = afterMs + HORIZON_MS;
  while (at.getTime() <= limit) {
    if (!schedule.months.has(at.getUTCMonth() + 1)) {
      at = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
    } else if (!dayMatches(schedule, at)) {
      at = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1));
    } else if (!schedule.hours.has(at.getUTCHours())) {
      at = new Date(at.getTime() + (60 - at.getUTCMinutes()) * MINUTE_MS);
    } else if (!schedule.minutes.has(at.getUTCMinutes())) {
      at = new Date(at.getTime() + MINUTE_MS);
    } else {
      return at.getTime();
    }
  }
  return null;
}

function dayMatches(schedule: CronSchedule, at: Date): boolean {
  const day = schedule.days.has(at.getUTCDate());
  const weekday = schedule.weekdays.has(at.getUTCDay());
  if (schedule.isDayRestricted && schedule.isWeekdayRestricted) return day || weekday;
  if (schedule.isDayRestricted) return day;
  if (schedule.isWeekdayRestricted) return weekday;
  return true;
}

type FieldRange = {
  readonly min: number;
  readonly max: number;
  readonly names: readonly string[];
  readonly nameBase?: number;
};

function parseField(field: string | undefined, range: FieldRange): Set<number> | null {
  if (field === undefined || field === '') return null;
  const values = new Set<number>();
  for (const part of field.split(',')) {
    const added = parsePart(part, range);
    if (added === null) return null;
    for (const value of added) values.add(value);
  }
  return values;
}

function parsePart(part: string, range: FieldRange): number[] | null {
  const [base, stepText] = part.split('/');
  const step = stepText === undefined ? 1 : Number(stepText);
  if (!Number.isInteger(step) || step < 1 || base === undefined) return null;
  const bounds = baseBounds(base, range, stepText !== undefined);
  if (bounds === null) return null;
  const values: number[] = [];
  for (let value = bounds.from; value <= bounds.to; value += step) values.push(value);
  return values;
}

function baseBounds(
  base: string,
  range: FieldRange,
  hasStep: boolean,
): { from: number; to: number } | null {
  if (base === '*') return { from: range.min, to: range.max };
  const [fromText, toText] = base.split('-');
  const from = valueOf(fromText, range);
  if (from === null) return null;
  if (toText === undefined) return { from, to: hasStep ? range.max : from };
  const to = valueOf(toText, range);
  return to === null || to < from ? null : { from, to };
}

function valueOf(text: string | undefined, range: FieldRange): number | null {
  if (text === undefined || text === '') return null;
  const named = range.names.indexOf(text.toUpperCase());
  const value = named === -1 ? Number(text) : named + (range.nameBase ?? 0);
  if (!Number.isInteger(value) || value < range.min || value > range.max) return null;
  return value;
}
